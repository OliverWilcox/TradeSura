import { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Switch, Pressable, ActivityIndicator, Share } from "react-native";
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
const PRICE_MIN_PENCE = 800;
const PRICE_MAX_PENCE = 2500;

function upliftLabel(t: Template) {
  if (t.kind === "CORE") return "";
  if (t.pricingLabel) return t.pricingLabel;
  if (t.upliftPence === null) return "";
  if (t.upliftPence === 0) return "no charge";
  return `+£${(t.upliftPence / 100).toFixed(2).replace(/\.00$/, "")}/mo`;
}

export default function TierEditor() {
  const { tierId, fresh } = useLocalSearchParams<{ tierId: string; fresh?: string }>();
  const [tier, setTier] = useState<TierDetail | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [pricePence, setPricePence] = useState(1200);
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
      setPricePence(data.tier.priceMonthlyPence);
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

  const fee = Math.round(pricePence * TRADESURA_FEE_RATE);
  function step(deltaPence: number) {
    setPricePence((p) => Math.min(PRICE_MAX_PENCE, Math.max(PRICE_MIN_PENCE, p + deltaPence)));
  }

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
    if (pricePence < PRICE_MIN_PENCE || pricePence > PRICE_MAX_PENCE) {
      setError(
        `Price must be between £${(PRICE_MIN_PENCE / 100).toFixed(0)} and £${(PRICE_MAX_PENCE / 100).toFixed(0)} a month.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const clauseCodes = templates.filter((t) => selected.has(t.id)).map((t) => t.code);
      const result = await api<{ ok: true; slug: string | null }>(`/api/tiers/${tierId}`, {
        method: "PUT",
        body: JSON.stringify({
          name,
          priceMonthlyPence: pricePence,
          isRecommended,
          clauseCodes,
          customLabels,
        }),
      });
      // E6 "Make it live" — show the confirmation with the live URL instead
      // of just popping back, same as any other save.
      setLiveUrl(result.slug ? `tradesura.com/p/${result.slug}` : null);
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
        <ActivityIndicator color="#5FA3F0" />
      </View>
    );
  }

  // E6 — "Make it live": the plan is already live the moment it saves (no
  // separate publish step), so this is a confirmation, not a wait.
  if (liveUrl) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-panel px-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-ok-tint">
          <Text className="text-3xl text-ok">✓</Text>
        </View>
        <Text className="text-center font-extrabold text-xl text-ink">
          {name} is live{fresh ? "" : " — updated"}
        </Text>
        <Card className="w-full">
          <Micro>Your customer page</Micro>
          <Text className="mt-1 font-mono font-semibold text-sm text-flame">{liveUrl}</Text>
        </Card>
        <View className="w-full gap-2">
          <Button
            onPress={() =>
              Share.share({ message: `https://${liveUrl}`, url: `https://${liveUrl}` }).catch(() => {})
            }
          >
            Share my customer page
          </Button>
          <Button variant="ghost" onPress={() => router.push("/offer")}>
            Offer it to a customer now
          </Button>
          <Button variant="ghost" onPress={() => router.replace("/(tabs)/plans")}>
            Back to my plans
          </Button>
        </View>
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
            className="flex-1 border-b border-line-soft font-semibold text-sm text-ink"
          />
          <View className="flex-row items-center gap-1.5">
            <Text className="font-sans text-xs text-muted">&ldquo;Most chosen&rdquo;</Text>
            <Switch value={isRecommended} onValueChange={setIsRecommended} />
          </View>
        </View>
        <Micro className="mb-1">Monthly price</Micro>
        <View className="flex-row items-center justify-center gap-6 py-1">
          <Pressable
            onPress={() => step(-50)}
            className="h-11 w-11 items-center justify-center rounded-xl border-[1.5px] border-flame"
          >
            <Text className="font-bold text-2xl text-flame-deep">−</Text>
          </Pressable>
          <Text className="font-mono font-semibold text-3xl text-ink">
            £{(pricePence / 100).toFixed(2)}
          </Text>
          <Pressable
            onPress={() => step(50)}
            className="h-11 w-11 items-center justify-center rounded-xl border-[1.5px] border-flame"
          >
            <Text className="font-bold text-2xl text-flame-deep">＋</Text>
          </Pressable>
        </View>
        <View className="mt-1 flex-row items-center justify-between gap-2">
          <Micro>Suggested from what you&apos;ve ticked</Micro>
          <Pressable
            onPress={() =>
              setPricePence(
                Math.min(PRICE_MAX_PENCE, Math.max(PRICE_MIN_PENCE, Math.round(suggestedPence / 50) * 50)),
              )
            }
            disabled={suggestedPence === pricePence}
          >
            <Text
              className={`font-mono font-semibold text-xs ${suggestedPence === pricePence ? "text-faint" : "text-flame-deep"}`}
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
                <Text className={`font-bold ${selected.has(t.id) ? "text-ok" : "text-line"}`}>
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
              <Text className="font-bold text-ok">✓ </Text>
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
            <Text className="px-2 font-semibold text-sm text-flame-deep">
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
          <Text className="mt-1.5 font-sans text-xs text-danger">{blocked.explanation}</Text>
          <Text className="mt-1.5 font-sans text-xs text-danger">
            Nearest approved clause: <Text className="font-semibold">{blocked.suggestion.title}</Text> — tick it
            in the list above instead.
          </Text>
        </Card>
      )}

      <Card className="border-flame-tint bg-flame-tint">
        <Text className="font-sans text-xs text-flame">
          <Text className="font-semibold">Legal wording locked in.</Text> Your plan document
          assembles only from solicitor-approved maintenance-and-priority clauses.
          Breakdown-repair promises are insurance — TradeSura keeps you on the right side of the
          line automatically.
        </Text>
      </Card>

      <Card>
        <Micro className="mb-1">What you&apos;ll earn</Micro>
        <Text className="font-mono font-semibold text-[15px] text-copper">
          £{((pricePence - fee) / 100).toFixed(2)} per customer per month
        </Text>
        <Text className="mt-0.5 font-sans text-[11px] text-faint">
          50 customers = £{(((pricePence - fee) * 12 * 50) / 100).toLocaleString()}/year
        </Text>
        <View className="mt-2 flex-row items-center justify-between border-t border-line-soft pt-2">
          <Text className="font-sans text-sm text-ink">TradeSura fee (20%)</Text>
          <Text className="font-mono text-ink">£{(fee / 100).toFixed(2)}/mo</Text>
        </View>
        <Text className="mt-1 font-sans text-[11px] text-faint">
          You keep 80%. Direct Debit processing (~32p per collection) comes out of your share.
        </Text>
      </Card>

      {error && <Text className="px-1 font-sans text-sm text-danger">{error}</Text>}
      <Button onPress={save} disabled={busy || selected.size === 0}>
        {busy ? "Making it live…" : fresh ? "Make it live" : "Save changes"}
      </Button>
    </ScrollView>
  );
}
