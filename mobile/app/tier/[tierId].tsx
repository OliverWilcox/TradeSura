import { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Switch, Pressable, ActivityIndicator } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { Card, Micro, Pill, Button } from "@/components/ui";

type Template = {
  id: string;
  code: string;
  title: string;
  kind: "CORE" | "ADD";
  category: string;
  upliftPence: number | null;
  pricingLabel: string | null;
  highlight: boolean;
};

type TierDetail = {
  id: string;
  name: string;
  priceMonthlyPence: number;
  isRecommended: boolean;
  customLabels: string[];
  clauseIds: string[];
};

// Duplicated from ../../../lib/clauses.ts — Metro's watchFolders keeps this
// app's resolution scoped to mobile/ (see metro.config.js), so this small,
// rarely-changing display math is copied rather than imported cross-repo.
// The wording blocklist itself is NOT duplicated — see /api/tiers/check-wording.
const CATEGORY_ORDER = [
  "Core gas servicing",
  "Warranty & admin",
  "Priority & access",
  "Discounts",
  "Landlord pack",
] as const;
const SUGGESTED_BASE_PENCE = 700;
const TRADESURA_FEE_RATE = 0.2;

function upliftLabel(t: Template) {
  if (t.kind === "CORE") return "";
  if (t.pricingLabel) return t.pricingLabel;
  if (t.upliftPence === null) return "";
  if (t.upliftPence === 0) return "no charge";
  return `+£${(t.upliftPence / 100).toFixed(2).replace(/\.00$/, "")}/mo`;
}

export default function TierEditor() {
  const { tierId } = useLocalSearchParams<{ tierId: string }>();
  const [tier, setTier] = useState<TierDetail | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [pounds, setPounds] = useState("");
  const [isRecommended, setIsRecommended] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customLabels, setCustomLabels] = useState<string[]>([]);
  const [draftLabel, setDraftLabel] = useState("");
  const [blocked, setBlocked] = useState<{
    explanation: string;
    suggestion: { title: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingLabel, setCheckingLabel] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ tier: TierDetail; templates: Template[] }>(
        `/api/tiers/${tierId}`,
      );
      setTier(data.tier);
      setTemplates(data.templates);
      setName(data.tier.name);
      setPounds((data.tier.priceMonthlyPence / 100).toFixed(2));
      setIsRecommended(data.tier.isRecommended);
      setSelected(new Set(data.tier.clauseIds));
      setCustomLabels(data.tier.customLabels);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load this plan.");
    }
  }, [tierId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const pricePence = Math.round(parseFloat(pounds || "0") * 100);
  const fee = Math.round(pricePence * TRADESURA_FEE_RATE);

  const suggestedPence = useMemo(
    () =>
      SUGGESTED_BASE_PENCE +
      templates
        .filter((t) => selected.has(t.id))
        .reduce((sum, t) => sum + (t.upliftPence ?? 0), 0),
    [selected, templates],
  );

  const grouped = useMemo(() => {
    const cats = [...new Set(templates.map((t) => t.category))].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]) -
        CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]),
    );
    return cats.map((c) => ({ category: c, items: templates.filter((t) => t.category === c) }));
  }, [templates]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function addLabel() {
    const label = draftLabel.trim();
    if (!label) return;
    setCheckingLabel(true);
    setBlocked(null);
    try {
      const check = await api<
        { ok: true } | { ok: false; explanation: string; suggestion: { title: string } }
      >("/api/tiers/check-wording", { method: "POST", body: JSON.stringify({ text: label }) });
      if (!check.ok) {
        setBlocked({ explanation: check.explanation, suggestion: check.suggestion });
        return;
      }
      setCustomLabels([...customLabels, label]);
      setDraftLabel("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check that wording.");
    } finally {
      setCheckingLabel(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const clauseCodes = templates.filter((t) => selected.has(t.id)).map((t) => t.code);
      await api(`/api/tiers/${tierId}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          priceMonthlyPence: pricePence,
          isRecommended,
          clauseCodes,
          customLabels,
        }),
      });
      router.back();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as
        | { explanation?: string; suggestion?: { title: string } }
        | undefined) : undefined;
      if (e instanceof ApiError && e.status === 422 && body?.explanation && body.suggestion) {
        setBlocked({ explanation: body.explanation, suggestion: body.suggestion });
      } else {
        setError(e instanceof ApiError ? e.message : "Could not save.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
        <Text className="font-sans text-sm text-danger">{loadError}</Text>
        <Button onPress={load} variant="ghost" className="w-full">
          Try again
        </Button>
      </View>
    );
  }

  if (!tier) {
    return (
      <View className="flex-1 items-center justify-center bg-panel">
        <ActivityIndicator color="#0E7FD0" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-panel" contentContainerClassName="gap-2.5 px-4 pb-8 pt-4">
      <Card>
        <View className="mb-2 flex-row items-center justify-between gap-2">
          <TextInput
            value={name}
            onChangeText={setName}
            className="flex-1 border-b border-line-soft font-sans-semibold text-sm text-ink"
          />
          <View className="flex-row items-center gap-1.5">
            <Text className="font-sans text-xs text-muted">&ldquo;Most chosen&rdquo;</Text>
            <Switch value={isRecommended} onValueChange={setIsRecommended} />
          </View>
        </View>
        <View className="flex-row items-center justify-between rounded-[10px] border border-line px-3 py-2">
          <Text className="font-sans text-sm text-ink">Monthly price</Text>
          <View className="flex-row items-center">
            <Text className="font-mono-semibold text-ink">£</Text>
            <TextInput
              value={pounds}
              onChangeText={(v) => setPounds(v.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              className="w-16 text-right font-mono-semibold text-ink"
            />
          </View>
        </View>
        <View className="mt-2 flex-row items-center justify-between gap-2">
          <Micro>Suggested from what you&apos;ve ticked</Micro>
          <Pressable onPress={() => setPounds((suggestedPence / 100).toFixed(2))} disabled={suggestedPence === pricePence}>
            <Text
              className={`font-mono-semibold text-xs ${suggestedPence === pricePence ? "text-faint" : "text-flame-deep"}`}
            >
              £{(suggestedPence / 100).toFixed(2)}/mo
              {suggestedPence !== pricePence && " — apply"}
            </Text>
          </Pressable>
        </View>
      </Card>

      {grouped.map(({ category, items }) => (
        <Card key={category}>
          <Micro className="mb-1">{category}</Micro>
          {items.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => toggle(t.id)}
              className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
            >
              <View className="shrink flex-row flex-wrap items-center gap-1.5">
                <Text className={`font-sans-bold ${selected.has(t.id) ? "text-ok" : "text-line"}`}>
                  {selected.has(t.id) ? "✓" : "○"}
                </Text>
                <Text className={`font-sans text-sm ${selected.has(t.id) ? "text-ink" : "text-faint"}`}>
                  {t.title}
                </Text>
                {t.highlight && <Pill tone="info">KEEPS THEM</Pill>}
              </View>
              <View className="flex-row items-center gap-1.5">
                <Text className="font-mono text-[11px] text-muted">{upliftLabel(t)}</Text>
                {t.kind === "CORE" && <Pill tone="ok">CORE</Pill>}
              </View>
            </Pressable>
          ))}
        </Card>
      ))}

      <Card>
        <Micro className="mb-1">Your own lines (display only)</Micro>
        {customLabels.map((label, i) => (
          <View
            key={i}
            className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2"
          >
            <Text className="font-sans text-sm text-ink">
              <Text className="font-sans-bold text-ok">✓ </Text>
              {label}
            </Text>
            <Pressable onPress={() => setCustomLabels(customLabels.filter((_, j) => j !== i))}>
              <Text className="font-sans text-xs text-faint">remove</Text>
            </Pressable>
          </View>
        ))}
        <View className="mt-2 flex-row items-center gap-2">
          <TextInput
            value={draftLabel}
            onChangeText={setDraftLabel}
            placeholder="Add your own line (display only)"
            className="flex-1 rounded-[10px] border border-line bg-paper px-3 py-2 font-sans text-sm text-ink"
          />
          <Pressable onPress={addLabel} disabled={checkingLabel}>
            <Text className="px-2 font-sans-semibold text-sm text-flame-deep">
              {checkingLabel ? "…" : "Add"}
            </Text>
          </Pressable>
        </View>
        <Text className="mt-2 font-sans text-[11px] text-faint">
          Shown on your customer page only. Never added to the legal plan document — that
          assembles from approved clauses alone.
        </Text>
      </Card>

      {blocked && (
        <Card className="border-danger-tint bg-danger-tint">
          <Pill tone="off">BLOCKED</Pill>
          <Text className="mt-1.5 font-sans text-xs text-[#8F2323]">{blocked.explanation}</Text>
          <Text className="mt-1.5 font-sans text-xs text-[#8F2323]">
            Nearest approved clause: <Text className="font-sans-semibold">{blocked.suggestion.title}</Text> — tick it
            in the list above instead.
          </Text>
        </Card>
      )}

      <Card className="border-[#BBDCF4] bg-flame-tint">
        <Text className="font-sans text-xs text-flame-deep">
          <Text className="font-sans-semibold">Legal wording locked in.</Text> Your plan document
          assembles only from solicitor-approved maintenance-and-priority clauses.
          Breakdown-repair promises are insurance — TradeSura keeps you on the right side of the
          line automatically.
        </Text>
      </Card>

      <Card>
        <View className="flex-row items-center justify-between border-b border-line-soft py-1.5">
          <Text className="font-sans text-sm text-ink">Est. take-home per customer</Text>
          <Text className="font-mono-semibold text-copper">
            £{((pricePence - fee) / 100).toFixed(2)}/mo
          </Text>
        </View>
        <View className="flex-row items-center justify-between py-1.5">
          <Text className="font-sans text-sm text-ink">TradeSura fee (20%)</Text>
          <Text className="font-mono text-ink">£{(fee / 100).toFixed(2)}/mo</Text>
        </View>
        <Text className="mt-1 font-sans text-[11px] text-faint">
          Direct Debit costs are charged by the payment provider on their standard terms.
        </Text>
      </Card>

      {error && <Text className="px-1 font-sans text-sm text-danger">{error}</Text>}
      <Button onPress={save} disabled={busy || selected.size === 0}>
        {busy ? "Saving…" : "Save tier"}
      </Button>
    </ScrollView>
  );
}
