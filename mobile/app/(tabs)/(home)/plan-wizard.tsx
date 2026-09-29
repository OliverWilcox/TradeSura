import { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, ApiError } from "@/lib/api";
import { Card, Micro, Pill, Button } from "@/components/ui";
import { Icon } from "@/components/icon";
import { useAuth } from "@/lib/auth-context";
import { CustomerPlanCard } from "@/components/plan-card";
import { CenteredSpinner } from "@/components/skeleton";

// Build Guide v2 Part 8 — "One builder, every door." This one component runs
// two modes:
//  - Create (no tierId, or a tierId from a quick-start draft): four steps in
//    sequence, nothing committed to the server until the user backs out with
//    real input (offered "keep as draft") or reaches Step 4's "Make this
//    plan live".
//  - Single-step edit (tierId + editStep): Part 7.4's "Edit plan" rows each
//    open straight to their one step, pre-filled, with its own
//    "Save changes" — no stepping through the rest.

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

// Duplicated from ../../../lib/clauses.ts by hand (mobile/CLAUDE.md's
// convention for small, non-compliance display constants — Metro's
// watchFolders keeps this app's resolution scoped to mobile/).
const CATEGORY_ORDER = [
  "Core gas servicing",
  "Warranty & admin",
  "Priority & access",
  "Discounts",
  "Landlord pack",
] as const;
const PRICE_MIN_PENCE = 800;
const PRICE_MAX_PENCE = 2500;
const PRICE_STEP_PENCE = 100; // Part 7.1/8: £1 steps.
const FEE_RATE = 0.2;
const NAME_MAX = 28;

function upliftLabel(t: Template) {
  if (t.kind === "CORE") return "included in every TradeSura plan";
  if (t.pricingLabel) return t.pricingLabel;
  if (t.upliftPence === null) return "";
  if (t.upliftPence === 0) return "no charge";
  return `+£${(t.upliftPence / 100).toFixed(2).replace(/\.00$/, "")}/mo`;
}

// Part 8 Step 3 — "suggestion chips built from the Step 1 selections." A
// simple, deterministic heuristic; the final name still runs the live
// blocklist regardless of where it came from.
function suggestNames(selectedTitles: string[]): string[] {
  const chips: string[] = ["Boiler Care"];
  const has = (re: RegExp) => selectedTitles.some((t) => re.test(t));
  if (has(/landlord|cp12|tenant/i)) chips.push("Landlord Care");
  if (has(/thermostat|control|smart/i)) chips.push("Boiler + Controls");
  if (has(/priority|same-day|evening|weekend/i)) chips.push("Priority Care");
  return [...new Set(chips)].slice(0, 3);
}

type Step = 1 | 2 | 3 | 4;

export default function PlanWizard() {
  const { refreshMe } = useAuth();
  const { tierId, editStep } = useLocalSearchParams<{
    tierId?: string;
    editStep?: string;
  }>();
  const isEdit = Boolean(tierId && editStep);
  const singleStep = (Number(editStep) as Step) || 1;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(tierId ?? null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [step, setStep] = useState<Step>(isEdit ? singleStep : 1);

  const [name, setName] = useState("New plan");
  const [pricePence, setPricePence] = useState(1200);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customLabels] = useState<string[]>([]);
  const [activePlanCount, setActivePlanCount] = useState(0);
  const [dirty, setDirty] = useState(false);

  const [blocked, setBlocked] = useState<{ explanation: string; suggestion: { title: string } } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (tierId) {
        const data = await api<{
          tier: { name: string; priceMonthlyPence: number; clauseIds: string[]; status: string };
          templates: Template[];
          activePlanCount: number;
        }>(`/api/tiers/${tierId}`);
        setTemplates(data.templates);
        setName(data.tier.name);
        setPricePence(data.tier.priceMonthlyPence);
        setSelected(new Set(data.tier.clauseIds));
        setActivePlanCount(data.activePlanCount);
      } else {
        const data = await api<Template[]>("/api/tiers/templates");
        setTemplates(data);
        setSelected(new Set(data.filter((t) => t.kind === "CORE").map((t) => t.code)));
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load the plan builder.");
    } finally {
      setLoading(false);
    }
  }, [tierId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function toggle(code: string, kind: "CORE" | "ADD") {
    if (kind === "CORE") return; // Part 7.1 LAW — required, unremovable.
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSelected(next);
    setDirty(true);
  }

  function stepPrice(delta: number) {
    setPricePence((p) => Math.min(PRICE_MAX_PENCE, Math.max(PRICE_MIN_PENCE, p + delta)));
    setDirty(true);
  }

  const grouped = useMemo(() => {
    const cats = [...new Set(templates.map((t) => t.category))].sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]) -
        CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]),
    );
    return cats.map((c) => ({ category: c, items: templates.filter((t) => t.category === c) }));
  }, [templates]);

  const selectedTitles = useMemo(
    () => templates.filter((t) => selected.has(t.code)).map((t) => t.title),
    [templates, selected],
  );
  const nameSuggestions = useMemo(() => suggestNames(selectedTitles), [selectedTitles]);

  const fee = Math.round(pricePence * FEE_RATE);
  const keepLine = `You keep £${((pricePence - fee) / 100).toFixed(2)} a month per customer.`;

  async function checkName(candidate: string): Promise<boolean> {
    setError(null);
    if (candidate.trim().length < 2) {
      setError("Give your plan a name — at least 2 characters.");
      return false;
    }
    try {
      const check = await api<
        { ok: true } | { ok: false; explanation: string; suggestion: { title: string } }
      >("/api/tiers/check-wording", { method: "POST", body: JSON.stringify({ text: candidate }) });
      if (!check.ok) {
        setBlocked({ explanation: check.explanation, suggestion: check.suggestion });
        return false;
      }
      setBlocked(null);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check that name.");
      return false;
    }
  }

  // Part 8: "Back exits freely before Step 4 — nothing committed until Make
  // this plan live. Exiting after real input offers keep-as-draft." A
  // quick-start draft (currentId already set) is saved on any edit too, so
  // nothing typed this session is silently lost.
  async function persistDraft() {
    setBusy(true);
    try {
      if (currentId) {
        await api(`/api/tiers/${currentId}`, {
          method: "PUT",
          body: JSON.stringify({ name, priceMonthlyPence: pricePence, clauseCodes: [...selected], customLabels }),
        });
      } else {
        await api("/api/tiers", {
          method: "POST",
          body: JSON.stringify({ name, priceMonthlyPence: pricePence, clauseCodes: [...selected], customLabels }),
        });
      }
    } catch {
      // Best-effort — exiting shouldn't hard-fail on a save error; the
      // engineer can always rebuild from a quick start.
    } finally {
      setBusy(false);
    }
  }

  function exit() {
    if (isEdit) {
      router.back();
      return;
    }
    if (!dirty && !currentId) {
      router.back();
      return;
    }
    Alert.alert("Keep this as a draft?", "You can come back and finish it any time from My plans.", [
      { text: "Discard", style: "destructive", onPress: () => router.back() },
      {
        text: "Keep as draft",
        onPress: async () => {
          await persistDraft();
          router.replace("/(tabs)/(home)/plans");
        },
      },
    ]);
  }

  async function saveSingleStep() {
    if (!currentId) return;
    if (step === 3) {
      const ok = await checkName(name);
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ activePlanCount: number }>(`/api/tiers/${currentId}`, {
        method: "PUT",
        body: JSON.stringify({ name, priceMonthlyPence: pricePence, clauseCodes: [...selected], customLabels }),
      });
      setActivePlanCount(result.activePlanCount);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { explanation?: string; suggestion?: { title: string } } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 422 && body?.explanation && body.suggestion) {
        setBlocked({ explanation: body.explanation, suggestion: body.suggestion });
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't save that.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    if (step === 3) {
      const ok = await checkName(name);
      if (!ok) return;
    }
    if (step < 4) {
      setStep((step + 1) as Step);
      return;
    }
    // Step 4 — "Make this plan live." (Part 8's finish line, and Part 20 #1's
    // "kill the app → reopen → the plan is still there" acceptance test.)
    setBusy(true);
    setError(null);
    try {
      let slug: string | null = null;
      if (currentId) {
        await api(`/api/tiers/${currentId}`, {
          method: "PUT",
          body: JSON.stringify({ name, priceMonthlyPence: pricePence, clauseCodes: [...selected], customLabels }),
        });
        const pub = await api<{ slug: string | null }>(`/api/tiers/${currentId}/publish`, { method: "POST" });
        slug = pub.slug;
      } else {
        const created = await api<{ id: string; status: string; slug: string | null }>("/api/tiers", {
          method: "POST",
          body: JSON.stringify({
            name,
            priceMonthlyPence: pricePence,
            clauseCodes: [...selected],
            customLabels,
            publishNow: true,
          }),
        });
        setCurrentId(created.id);
        slug = created.slug;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // First live plan wakes the Add-customer hero and the offer gate.
      refreshMe();
      setLiveUrl(slug ? `tradesura.com/p/${slug}` : "your customer page");
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { explanation?: string; suggestion?: { title: string } } | undefined) : undefined;
      if (e instanceof ApiError && e.status === 422 && body?.explanation && body.suggestion) {
        setBlocked({ explanation: body.explanation, suggestion: body.suggestion });
      } else {
        setError(e instanceof ApiError ? e.message : "Couldn't make this plan live.");
      }
    } finally {
      setBusy(false);
    }
  }

  const stepTitle = isEdit
    ? (["", "What's included", "Price", "Name"][singleStep] ?? "Edit")
    : `New plan · Step ${step} of 4`;

  if (loading) {
    return (
      <View className="flex-1 bg-panel">
        <CenteredSpinner label="Loading plan builder" />
      </View>
    );
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

  if (liveUrl) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-panel px-6">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-ok-tint">
          <Icon name="verified" size={34} color="#3dd68c" />
        </View>
        <Text className="text-center text-xl font-extrabold text-ink">{name} is live</Text>
        <Card className="w-full">
          <Micro>Your customer page</Micro>
          <Text className="mt-1 font-mono font-semibold text-sm text-flame">{liveUrl}</Text>
        </Card>
        <View className="w-full gap-2">
          <Button onPress={() => router.replace("/offer")}>Offer it to a customer now</Button>
          <Button variant="ghost" onPress={() => router.replace("/(tabs)/(home)/plans")}>
            Back to My plans
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <View className="flex-row items-center gap-2 border-b border-line bg-bg-deep px-3 py-3">
          <Pressable onPress={exit} hitSlop={10} className="h-8 w-8 items-center justify-center">
            <Icon name={isEdit ? "close" : "back"} size={20} weight="semibold" />
          </Pressable>
          <Text className="flex-1 text-[17px] font-bold text-ink" numberOfLines={1}>
            {stepTitle}
          </Text>
        </View>
      </SafeAreaView>

      <ScrollView className="flex-1" contentContainerClassName="gap-2.5 px-4 pb-8 pt-4">
        {!isEdit && (
          <View className="mb-1 h-1.5 overflow-hidden rounded-full bg-line-soft">
            <View className="h-full rounded-full bg-flame" style={{ width: `${(step / 4) * 100}%` }} />
          </View>
        )}

        {activePlanCount > 0 && (
          <Card className="border-warn-tint bg-warn-tint">
            <Text className="font-sans text-xs text-warn">
              Changes apply to new customers — your {activePlanCount} current customer
              {activePlanCount === 1 ? "" : "s"} keep what they signed up for.
            </Text>
          </Card>
        )}

        {/* Step 1 — What's included */}
        {step === 1 && (
          <>
            {grouped.map(({ category, items }) => (
              <Card key={category}>
                <Micro className="mb-1">{category}</Micro>
                {items.map((t) => {
                  const on = selected.has(t.code);
                  const locked = t.kind === "CORE";
                  return (
                    <Pressable
                      key={t.code}
                      onPress={() => toggle(t.code, t.kind)}
                      disabled={locked}
                      className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
                    >
                      <View className="shrink flex-row flex-wrap items-center gap-1.5">
                        <Icon name="check" size={14} color={on ? "#f3f7fb" : "#334866"} weight="bold" />
                        <Text className={`font-sans text-sm ${on ? "text-ink" : "text-faint"}`}>{t.title}</Text>
                        {t.highlight && <Pill tone="info">KEEPS THEM</Pill>}
                      </View>
                      <Text className="font-mono text-[11px] text-muted">{upliftLabel(t)}</Text>
                    </Pressable>
                  );
                })}
              </Card>
            ))}
            <Micro className="text-center">
              {selected.size} selected — plans read best with 3 to 6.
            </Micro>
          </>
        )}

        {/* Step 2 — Set your price */}
        {step === 2 && (
          <Card>
            <Micro className="mb-1 text-center">Monthly price</Micro>
            <View className="flex-row items-center justify-center gap-6 py-2">
              <Pressable
                onPress={() => stepPrice(-PRICE_STEP_PENCE)}
                className="h-11 w-11 items-center justify-center rounded-xl border-[1.5px] border-flame"
              >
                <Text className="text-2xl font-bold text-flame-deep">−</Text>
              </Pressable>
              <Text className="font-mono text-3xl font-semibold text-ink">
                £{(pricePence / 100).toFixed(0)}
              </Text>
              <Pressable
                onPress={() => stepPrice(PRICE_STEP_PENCE)}
                className="h-11 w-11 items-center justify-center rounded-xl border-[1.5px] border-flame"
              >
                <Text className="text-2xl font-bold text-flame-deep">＋</Text>
              </Pressable>
            </View>
            <Text className="text-center font-sans text-xs text-muted">
              Your plan, your price — most sit between £10 and £15.
            </Text>
            <View className="mt-3 border-t border-line-strong pt-3">
              <Text className="text-center font-mono text-sm font-semibold text-ok">{keepLine}</Text>
              <Text className="mt-1 text-center font-sans text-[11px] text-faint">
                TradeSura fee (20%): £{(fee / 100).toFixed(2)}/mo
              </Text>
            </View>
          </Card>
        )}

        {/* Step 3 — Name your plan */}
        {step === 3 && (
          <Card>
            <Micro className="mb-1.5">Plan name</Micro>
            <TextInput
              value={name}
              onChangeText={(v) => {
                setName(v.slice(0, NAME_MAX));
                setBlocked(null);
                setDirty(true);
              }}
              maxLength={NAME_MAX}
              className="min-h-[48px] rounded-[10px] border border-line bg-paper px-3.5 font-sans text-[16px] text-ink"
            />
            <Text className="mt-1 text-right font-mono text-[10px] text-faint">
              {name.length}/{NAME_MAX}
            </Text>
            {nameSuggestions.length > 0 && (
              <View className="mt-2 flex-row flex-wrap gap-1.5">
                {nameSuggestions.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => {
                      setName(s.slice(0, NAME_MAX));
                      setBlocked(null);
                      setDirty(true);
                    }}
                    className="rounded-full border border-line bg-panel px-3 py-1.5"
                  >
                    <Text className="font-mono text-xs text-flame-deep">{s}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {blocked && (
              <Card className="mt-3 border-danger-tint bg-danger-tint">
                <Text className="font-sans text-xs text-danger">{blocked.explanation}</Text>
                <Text className="mt-1 font-sans text-xs text-danger">
                  Try something like <Text className="font-semibold">{blocked.suggestion.title}</Text> instead.
                </Text>
              </Card>
            )}
          </Card>
        )}

        {/* Step 4 — Check your plan */}
        {step === 4 && !isEdit && (
          <>
            <Text className="px-1 font-sans text-sm text-muted">
              This is exactly what customers will see.
            </Text>
            <CustomerPlanCard name={name} priceMonthlyPence={pricePence} lines={selectedTitles} />
          </>
        )}

        {error && <Text className="px-1 font-sans text-sm text-danger">{error}</Text>}

        {isEdit ? (
          <Button onPress={saveSingleStep} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        ) : (
          <Button onPress={goNext} disabled={busy}>
            {busy ? "Working…" : step < 4 ? "Next" : "Make this plan live"}
          </Button>
        )}
      </ScrollView>
    </View>
  );
}
