import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  Linking,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { api, ApiError, apiUrl } from "@/lib/api";
import { Card, Button } from "@/components/ui";
import { Icon } from "@/components/icon";
import { useAuth } from "@/lib/auth-context";
import { CustomerPlanCard, CustomerPlanPeek, type PlanLine } from "@/components/plan-card";
import { CenteredSpinner } from "@/components/skeleton";
import { Slider } from "@/components/slider";
import { StripeBadge } from "@/components/stripe-badge";
import { Toggle } from "@/components/toggle";

// The plan builder, matched to the 2026 Build Guide target screens
// (TARGET_wizard_step1–4). One component, two modes:
//  - Create: four steps in sequence. The plan is saved as a DRAFT from the
//    first "Next" ("Draft saved"), and goes live only on Step 4's "Make this
//    plan live" with the provision promise ticked.
//  - Single-step edit (tierId + editStep): "Edit plan" rows open straight to
//    their one step, pre-filled, with its own "Save changes".

type Template = {
  id: string;
  code: string;
  title: string;
  kind: "CORE" | "ADD";
  category: string;
  upliftPence: number | null;
  pricingLabel: string | null;
  highlight: boolean;
  note: string | null;
  engineerNote: string | null;
  bodyText: string;
};
type Preset = { name: string; priceMonthlyPence: number; clauseCodes: string[] };

// Small, non-compliance display constants duplicated by hand from
// ../../../lib/clauses.ts (mobile/CLAUDE.md's convention).
const CATEGORY_ORDER = [
  "Core gas servicing",
  "Priority & access",
  "Warranty & admin",
  "Discounts",
  "Landlord pack",
] as const;
// Open by default; the rest fold into a row with an "N on" count.
const OPEN_CATEGORIES = new Set(["Core gas servicing", "Priority & access"]);
const PRICE_MIN_PENCE = 1000;
// Build Review 2, ruling 1 — £10 minimum, no business maximum (the max is a
// typo guard, mirrored from ../../../lib/clauses.ts).
const PRICE_MAX_PENCE = 100000;
const PRICE_STEP_PENCE = 100;
const SUGGESTED_BASE_PENCE = 700;
// Ruling 2 — pre-ticked in a new plan but removable. Mirrors lib/clauses.ts.
const DEFAULT_ON_CODES = ["ANNUAL_SERVICE"];
const FEE_RATE = 0.2;
const NAME_MAX = 28;
const NAME_CHIPS = ["Boiler Care", "Boiler Care Plus", "Complete Care"];
const LANDLORD_NAME_CHIPS = ["Landlord Care", "Landlord Care Plus", "Landlord Complete"];
// Section 5 rules mirrored from ../../../lib/clauses.ts for instant feedback;
// the server (lib/plan-rules.ts) is the gate.
const CORE_CATEGORY = "Core gas servicing";
const LANDLORD_CATEGORY = "Landlord pack";
const RATE_LABEL = "you set the rate";
const RECOMMENDED_MIN = 3;
const RECOMMENDED_MAX = 6;
const SCRATCH = "Start from scratch";

function pounds(pence: number, alwaysPence = false) {
  const s = (pence / 100).toFixed(2);
  return `£${alwaysPence ? s : s.replace(/\.00$/, "")}`;
}
function roundPounds(pence: number) {
  return `£${Math.round(pence / 100).toLocaleString("en-GB")}`;
}
function guidePence(selected: Template[]) {
  const sum = selected.reduce((a, t) => a + (t.upliftPence ?? 0), SUGGESTED_BASE_PENCE);
  return Math.max(PRICE_MIN_PENCE, Math.round(sum / 100) * 100);
}
// Review 3 — our 20% rounds DOWN to the penny, in the engineer's favour.
function keepPence(pricePence: number) {
  return pricePence - Math.floor(pricePence * FEE_RATE);
}

type Step = 1 | 2 | 3 | 4;

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-flame">{children}</Text>
  );
}

export default function PlanWizard() {
  const { me, refreshMe } = useAuth();
  const { tierId, editStep, from } = useLocalSearchParams<{ tierId?: string; editStep?: string; from?: string }>();
  // Part 5/8 — setup's "Build my plan" opens this same flow with a "Back to
  // setup" bar. One builder, every door.
  const fromSetup = from === "setup";
  const isEdit = Boolean(tierId && editStep);
  const singleStep = (Number(editStep) as Step) || 1;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(tierId ?? null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [starter, setStarter] = useState<string | null>(null);
  const [step, setStep] = useState<Step>(isEdit ? singleStep : 1);

  // Review 3 — the box starts empty (or from the quick start), never "New plan".
  const [name, setName] = useState("");
  const [pricePence, setPricePence] = useState(1200);
  const [priceTouched, setPriceTouched] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [customLabels, setCustomLabels] = useState<string[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  // Rate boxes are free text on the customer's page, so they run the same
  // word filter as the plan name (server-side, via check-wording).
  const [rateBlocked, setRateBlocked] = useState<Record<string, string>>({});
  const [qualified, setQualified] = useState<Record<string, string>>({});
  const [qualPrompts, setQualPrompts] = useState<Record<string, string>>({});
  const [qualAsk, setQualAsk] = useState<Template | null>(null);
  const [qualTicked, setQualTicked] = useState(false);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [activePlanCount, setActivePlanCount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  const [openCats, setOpenCats] = useState<Set<string>>(new Set(OPEN_CATEGORIES));
  const [info, setInfo] = useState<Template | null>(null);
  const [typingPrice, setTypingPrice] = useState(false);
  const [priceText, setPriceText] = useState("");
  const [customers, setCustomers] = useState(10);
  const [tipsOpen, setTipsOpen] = useState(false);
  const [attested, setAttested] = useState(false);

  const [blocked, setBlocked] = useState<{ explanation: string; suggestion: { title: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      if (tierId) {
        const data = await api<{
          tier: {
            name: string;
            priceMonthlyPence: number;
            clauseIds: string[];
            customLabels: string[];
            clauseRates?: Record<string, string>;
          };
          templates: Template[];
          activePlanCount: number;
        }>(`/api/tiers/${tierId}`);
        setTemplates(data.templates);
        setName(data.tier.name);
        setPricePence(data.tier.priceMonthlyPence);
        setPriceTouched(true);
        // The tier stores clause ids; the picker and the API speak codes.
        const ids = new Set(data.tier.clauseIds);
        setSelected(new Set(data.templates.filter((t) => ids.has(t.id)).map((t) => t.code)));
        setCustomLabels(data.tier.customLabels ?? []);
        setRates(data.tier.clauseRates ?? {});
        setActivePlanCount(data.activePlanCount);
        setSavedOnce(true);
        if (!isEdit) {
          const p = await api<Preset[]>("/api/tiers/presets");
          setPresets(p);
        }
      } else {
        const [t, p] = await Promise.all([
          api<Template[]>("/api/tiers/templates"),
          api<Preset[]>("/api/tiers/presets"),
        ]);
        setTemplates(t);
        setPresets(p);
        // Target Step 1 opens on Boiler Care, ready to tweak.
        const first = p[0];
        const core = t.filter((x) => x.kind === "CORE" || DEFAULT_ON_CODES.includes(x.code)).map((x) => x.code);
        if (first) {
          setStarter(first.name);
          setSelected(new Set([...core, ...first.clauseCodes]));
          setName(first.name);
        } else {
          setSelected(new Set(core));
        }
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load the plan builder.");
    } finally {
      setLoading(false);
    }
  }, [tierId, isEdit]);

  useFocusEffect(
    useCallback(() => {
      load();
      // R12 — which qualification confirmations this engineer has given.
      api<{ prompts: Record<string, string>; confirmed: Record<string, string> }>("/api/me/qualifications")
        .then((q) => {
          setQualPrompts(q.prompts);
          setQualified(q.confirmed);
        })
        .catch(() => {});
    }, [load]),
  );

  const byCode = useMemo(() => new Map(templates.map((t) => [t.code, t])), [templates]);
  const selectedTemplates = useMemo(
    () => templates.filter((t) => selected.has(t.code)),
    [templates, selected],
  );
  const guide = guidePence(selectedTemplates);

  // R2/R3 — no annual service means at least one other Core gas servicing
  // item, so every plan includes real maintenance. Mirrors lib/clauses.ts.
  const serviceRuleError =
    templates.length > 0 &&
    !selected.has("ANNUAL_SERVICE") &&
    !templates.some((t) => t.category === CORE_CATEGORY && selected.has(t.code))
      ? "Without the annual service, switch on at least one other Core gas servicing item so the plan includes real maintenance."
      : null;
  // R6 — "you set the rate" options need the engineer's rate.
  const missingRates = templates.filter(
    (t) => t.pricingLabel === RATE_LABEL && selected.has(t.code) && !rates[t.code]?.trim(),
  );
  const blockedRate = templates.find((t) => selected.has(t.code) && rateBlocked[t.code]);
  const rateError = blockedRate
    ? `Your rate for "${blockedRate.title}" can't say that: that wording makes this an insurance product. Enter just the rate, like 10% off.`
    : missingRates.length
      ? `Enter your rate for ${missingRates.map((t) => t.title).join(" and ")}.`
      : null;
  const landlordPlan = templates.some((t) => t.category === LANDLORD_CATEGORY && selected.has(t.code));
  const suggestedName = landlordPlan ? "Landlord Care" : "Boiler Care";
  // Until the engineer sets a price themselves, the price follows the guide.
  const price = priceTouched ? pricePence : guide;
  const keep = keepPence(price);
  const fee = price - keep;

  // Core first, then the order the library lists them in.
  const customerLines: PlanLine[] = useMemo(
    () => [
      ...selectedTemplates.map((t) => ({
        title: rates[t.code]?.trim() ? `${t.title}: ${rates[t.code].trim()}` : t.title,
        note: t.note,
      })),
      ...customLabels.map((l) => ({ title: l })),
    ],
    [selectedTemplates, customLabels, rates],
  );

  const grouped = useMemo(() => {
    const cats = [...new Set(templates.map((t) => t.category))].sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a as (typeof CATEGORY_ORDER)[number]) -
        CATEGORY_ORDER.indexOf(b as (typeof CATEGORY_ORDER)[number]),
    );
    return cats.map((c) => ({ category: c, items: templates.filter((t) => t.category === c) }));
  }, [templates]);

  const tradingName = me?.tradingName?.trim() || "Your business";
  const verified = Boolean(me?.gasSafeVerifiedAt);

  function markDirty() {
    setDirty(true);
  }

  function applyStarter(label: string) {
    Haptics.selectionAsync().catch(() => {});
    const core = templates
      .filter((t) => t.kind === "CORE" || DEFAULT_ON_CODES.includes(t.code))
      .map((t) => t.code);
    setStarter(label);
    if (label === SCRATCH) {
      setSelected(new Set(core));
      if (!isEdit && !savedOnce) setName("");
    } else {
      const p = presets.find((x) => x.name === label);
      if (!p) return;
      setSelected(new Set([...core, ...p.clauseCodes.filter((c) => byCode.has(c))]));
      if (!isEdit && !savedOnce) setName(p.name);
    }
    markDirty();
  }

  function toggle(t: Template) {
    if (t.kind === "CORE") return; // required, unremovable — the server enforces it too.
    // R12 — switching on an option that needs a qualification asks first.
    if (!selected.has(t.code) && qualPrompts[t.code] && !qualified[t.code]) {
      setQualTicked(false);
      setQualAsk(t);
      return;
    }
    const next = new Set(selected);
    if (next.has(t.code)) next.delete(t.code);
    else next.add(t.code);
    setSelected(next);
    setStarter(null);
    markDirty();
  }

  async function confirmQualification() {
    const t = qualAsk;
    if (!t || !qualTicked) return;
    try {
      const r = await api<{ confirmed: Record<string, string> }>("/api/me/qualifications", {
        method: "POST",
        body: JSON.stringify({ code: t.code }),
      });
      setQualified(r.confirmed);
      setSelected(new Set([...selected, t.code]));
      setStarter(null);
      markDirty();
      setQualAsk(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save that — try again.");
      setQualAsk(null);
    }
  }

  function setPrice(p: number) {
    // Review 3 P2 — say why the minus stops at £10 rather than just stopping.
    setPriceNote(p < PRICE_MIN_PENCE ? "£10 is the lowest price." : null);
    setPricePence(Math.min(PRICE_MAX_PENCE, Math.max(PRICE_MIN_PENCE, p)));
    setPriceTouched(true);
    markDirty();
  }

  function commitTypedPrice() {
    const v = Math.round(parseFloat(priceText.replace(/[£,\s]/g, "")) * 100);
    if (Number.isFinite(v) && v > 0) setPrice(v);
    setTypingPrice(false);
  }

  function payload() {
    return JSON.stringify({
      name: name.trim(),
      priceMonthlyPence: price,
      clauseCodes: [...selected],
      customLabels,
      clauseRates: rates,
    });
  }

  function showBlocked(e: unknown): boolean {
    const body = e instanceof ApiError ? (e.body as { explanation?: string; suggestion?: { title: string } } | undefined) : undefined;
    if (e instanceof ApiError && e.status === 422 && body?.explanation && body.suggestion) {
      setBlocked({ explanation: body.explanation, suggestion: body.suggestion });
      return true;
    }
    return false;
  }

  async function checkName(candidate: string): Promise<boolean> {
    setError(null);
    if (/^\s*new\s+plan\s*$/i.test(candidate)) {
      setError("Give your plan a name customers will understand, like Boiler Care.");
      return false;
    }
    if (candidate.trim().length < 2) {
      setError("Give your plan a name — at least 2 characters.");
      return false;
    }
    try {
      const check = await api<{ ok: true } | { ok: false; explanation: string; suggestion: { title: string } }>(
        "/api/tiers/check-wording",
        { method: "POST", body: JSON.stringify({ text: candidate }) },
      );
      if (!check.ok) {
        setBlocked({ explanation: check.explanation, suggestion: { title: suggestedName } });
        return false;
      }
      setBlocked(null);
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't check that name.");
      return false;
    }
  }

  useEffect(() => {
    const entries = Object.entries(rates).filter(([, v]) => v.trim());
    const t = setTimeout(async () => {
      const next: Record<string, string> = {};
      for (const [code, v] of entries) {
        try {
          const check = await api<{ ok: true } | { ok: false; explanation: string }>("/api/tiers/check-wording", {
            method: "POST",
            body: JSON.stringify({ text: v.trim() }),
          });
          if (!check.ok) next[code] = check.explanation;
        } catch {
          // The server re-checks on save; a failed live check isn't a block.
        }
      }
      setRateBlocked(next);
    }, 400);
    return () => clearTimeout(t);
  }, [rates]);

  // Part 8 Step 3 — the blocklist runs live as they type (Build Review 2),
  // not only when Next is tapped.
  useEffect(() => {
    if (step !== 3 || name.trim().length < 2) return;
    const t = setTimeout(() => {
      checkName(name);
    }, 400);
    return () => clearTimeout(t);
  }, [name, step]);

  // "Draft saved" — every Next writes the draft, so leaving never loses work.
  // Returns the plan's id (null on failure) — state updates land too late
  // for the publish call that follows on Step 4.
  async function saveDraft(): Promise<string | null> {
    try {
      let id = currentId;
      if (id) {
        await api(`/api/tiers/${id}`, { method: "PUT", body: payload() });
      } else {
        const created = await api<{ id: string }>("/api/tiers", { method: "POST", body: payload() });
        id = created.id;
        setCurrentId(id);
      }
      setSavedOnce(true);
      setDirty(false);
      return id;
    } catch (e) {
      if (!showBlocked(e)) setError(e instanceof ApiError ? e.message : "Couldn't save your draft.");
      return null;
    }
  }

  // Review 3 P0 — Back goes to the previous step with everything kept; only
  // Step 1's Back leaves the wizard (the draft is saved at every Next).
  function exit() {
    if (!isEdit && step > 1) {
      setError(null);
      setStep((step - 1) as Step);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    if (isEdit || !dirty) {
      router.back();
      return;
    }
    Alert.alert("Keep this as a draft?", "You can come back and finish it any time from My plans.", [
      {
        text: "Discard changes",
        style: "destructive",
        onPress: () => router.back(),
      },
      {
        text: "Keep as draft",
        onPress: async () => {
          setBusy(true);
          await saveDraft();
          setBusy(false);
          router.replace("/(tabs)/(home)/plans");
        },
      },
    ]);
  }

  async function saveSingleStep() {
    if (!currentId) return;
    if (step === 3 && !(await checkName(name))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ activePlanCount: number }>(`/api/tiers/${currentId}`, {
        method: "PUT",
        body: payload(),
      });
      setActivePlanCount(result.activePlanCount);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (e) {
      if (!showBlocked(e)) setError(e instanceof ApiError ? e.message : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  async function goNext() {
    setError(null);
    if (step === 1 && serviceRuleError) return;
    if (step === 1 && rateError) {
      setError(rateError);
      return;
    }
    if (step === 3 && !(await checkName(name))) return;
    if (step < 4) {
      setBusy(true);
      const ok = await saveDraft();
      setBusy(false);
      if (!ok) return;
      setStep((step + 1) as Step);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    // Step 4 — "Make this plan live."
    if (!attested) {
      setError("Tick the box to confirm you'll provide everything in this plan.");
      return;
    }
    setBusy(true);
    try {
      const id = await saveDraft();
      if (!id) return;
      await api(`/api/tiers/${id}/publish`, {
        method: "POST",
        body: JSON.stringify({ attest: true }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      refreshMe(); // first live plan wakes the dashboard ring and the offer gate
      router.replace({
        pathname: "/plan-live",
        params: { name, pricePence: String(price) },
      });
    } catch (e) {
      if (!showBlocked(e)) setError(e instanceof ApiError ? e.message : "Couldn't make this plan live.");
    } finally {
      setBusy(false);
    }
  }

  function jumpTo(s: Step) {
    setStep(s);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
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

  const optionCount = selected.size + customLabels.length;
  const nextLabel = busy ? "Working…" : step < 4 ? "Next" : "Make this plan live";

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top"]} className="bg-bg">
        <View className="flex-row items-center gap-2 px-3 pb-2 pt-2">
          <Pressable
            onPress={exit}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={isEdit ? "Close" : "Back"}
            className="h-9 w-9 items-center justify-center"
          >
            <Icon name={isEdit ? "close" : "back"} size={20} weight="semibold" />
          </Pressable>
          <Text className="flex-1 text-[19px] font-bold text-ink" numberOfLines={1}>
            {stepTitle}
          </Text>
          {/* Saved at every Next, so it stays on while they edit the step. */}
          {!isEdit && savedOnce && (
            <View className="flex-row items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5">
              <Icon name="saved" size={14} />
              <Text className="text-[12.5px] text-ink">Draft saved</Text>
            </View>
          )}
        </View>
        {fromSetup && !isEdit && (
          <Pressable
            onPress={() => router.navigate("/onboarding")}
            className="flex-row items-center gap-1.5 px-4 pb-2"
            accessibilityRole="button"
          >
            <Icon name="back" size={14} color="#5FA3F0" weight="semibold" />
            <Text className="text-[14px] font-semibold text-flame">Back to setup</Text>
          </Pressable>
        )}
        {!isEdit && (
          <View className="mx-4 mb-1 h-1.5 overflow-hidden rounded-full bg-line-strong">
            <View className="h-full rounded-full bg-flame" style={{ width: `${(step / 4) * 100}%` }} />
          </View>
        )}
      </SafeAreaView>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="gap-3 px-4 pb-8 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        {activePlanCount > 0 && (
          <Card className="border-warn-tint bg-warn-tint">
            <Text className="text-xs text-warn">
              Changes apply to new customers — your {activePlanCount} current customer
              {activePlanCount === 1 ? "" : "s"} keep what they signed up for.
            </Text>
          </Card>
        )}

        {/* Step 1 — What's included */}
        {step === 1 && (
          <>
            <View>
              <Text className="text-[22px] font-bold text-ink">Build your care plan</Text>
              <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
                Pick what&apos;s included, set your price, then name it. Most engineers offer 2 or 3
                plans, and you can add more any time.
              </Text>
            </View>

            {presets.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-1">
                {[...presets.map((p) => p.name), SCRATCH].map((label) => {
                  const on = starter === label;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => applyStarter(label)}
                      className={`rounded-full border px-4 py-2.5 ${on ? "border-flame bg-flame" : label === SCRATCH ? "border-white/70" : "border-line-strong"}`}
                    >
                      <Text className={`text-[14px] ${on ? "font-semibold text-white" : "text-ink"}`}>
                        {label === "Landlord Care" ? "Landlord" : label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {grouped.map(({ category, items }) => {
              const onCount = items.filter((t) => selected.has(t.code)).length;
              const open = openCats.has(category);
              if (!open) {
                return (
                  <Pressable
                    key={category}
                    onPress={() => setOpenCats(new Set([...openCats, category]))}
                    className="flex-row items-center justify-between rounded-2xl border border-line-strong px-4 py-3.5"
                  >
                    <Text className="text-[14px] font-bold uppercase tracking-[0.08em] text-ink">
                      {category} <Text className="font-normal normal-case tracking-normal text-muted">· {onCount} on</Text>
                    </Text>
                    <Icon name="chevron" size={14} color="#9fb6d0" weight="semibold" />
                  </Pressable>
                );
              }
              return (
                <View key={category} className="rounded-2xl border border-line-strong px-4 pb-1 pt-3.5">
                  <Pressable
                    onPress={() => {
                      const next = new Set(openCats);
                      next.delete(category);
                      setOpenCats(next);
                    }}
                    disabled={OPEN_CATEGORIES.has(category)}
                  >
                    <SectionTitle>{category}</SectionTitle>
                  </Pressable>
                  {items.map((t) => {
                    const on = selected.has(t.code);
                    const locked = t.kind === "CORE";
                    const sub = locked
                      ? "Included in every TradeSura plan"
                      : t.engineerNote
                        ? `Optional · ${t.engineerNote}`
                        : t.pricingLabel;
                    return (
                      <View key={t.code} className="flex-row items-center gap-3 py-2.5">
                        <View className="flex-1">
                          {/* The (i) stays beside the name when a long name wraps. */}
                          <View className="flex-row items-center gap-2">
                            <Text className="shrink text-[16px] text-ink">{t.title}</Text>
                            {locked ? (
                              <Icon name="lock" size={15} color="#c9d6e6" />
                            ) : (
                              <Pressable
                                onPress={() => setInfo(t)}
                                hitSlop={10}
                                accessibilityRole="button"
                                accessibilityLabel={`What ${t.title} means`}
                              >
                                <Icon name="info" size={17} color="#c9d6e6" />
                              </Pressable>
                            )}
                          </View>
                          {sub ? <Text className="mt-0.5 text-[12.5px] text-muted">{sub}</Text> : null}
                          {on && t.pricingLabel === RATE_LABEL && (
                            <TextInput
                              value={rates[t.code] ?? ""}
                              onChangeText={(v) => {
                                setRates({ ...rates, [t.code]: v.slice(0, 40) });
                                markDirty();
                              }}
                              placeholder="Your rate, e.g. 10% off"
                              placeholderTextColor="#6e86a3"
                              accessibilityLabel={`Your rate for ${t.title}`}
                              className={`mt-2 min-h-[42px] rounded-xl border bg-bg px-3 text-[15px] text-ink ${rateBlocked[t.code] ? "border-warn" : "border-line-strong"}`}
                            />
                          )}
                        </View>
                        <Toggle
                          value={on}
                          onValueChange={() => toggle(t)}
                          disabled={locked}
                          accessibilityLabel={t.title}
                        />
                      </View>
                    );
                  })}
                </View>
              );
            })}
          </>
        )}

        {step === 1 && (serviceRuleError || rateError) && (
          <Text className="px-1 text-center text-[13px] text-warn">{serviceRuleError ?? rateError}</Text>
        )}

        {/* Step 2 — Set your price */}
        {step === 2 && (
          <>
            <View>
              <Text className="text-[22px] font-bold text-ink">Set your price</Text>
              <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
                Customers pay this monthly by Direct Debit. You keep 80%, paid every Friday.
              </Text>
            </View>

            <Card>
              <Text className="text-center text-[12px] font-bold uppercase tracking-[0.12em] text-muted">
                Monthly price
              </Text>
              <View className="mt-2 flex-row items-center justify-between">
                <Pressable
                  onPress={() => setPrice(price - PRICE_STEP_PENCE)}
                  accessibilityLabel="Lower the price by £1"
                  className="h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-white/80"
                >
                  <Icon name="minus" size={20} weight="semibold" />
                </Pressable>
                {typingPrice ? (
                  <TextInput
                    value={priceText}
                    onChangeText={setPriceText}
                    onBlur={commitTypedPrice}
                    onSubmitEditing={commitTypedPrice}
                    keyboardType="decimal-pad"
                    autoFocus
                    // Starts empty (the current price shows as the hint), so
                    // typing replaces the price instead of adding to it.
                    placeholder={(price / 100).toFixed(2)}
                    placeholderTextColor="#6e86a3"
                    returnKeyType="done"
                    className="min-w-[150px] text-center text-[44px] font-extrabold text-ink"
                  />
                ) : (
                  <Pressable
                    onPress={() => {
                      setPriceText("");
                      setTypingPrice(true);
                    }}
                    accessibilityLabel={`Monthly price ${pounds(price, true)}. Tap to type a price.`}
                  >
                    <Text className="text-[48px] font-extrabold text-ink" style={{ fontVariant: ["tabular-nums"] }}>
                      {pounds(price, true)}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => setPrice(price + PRICE_STEP_PENCE)}
                  accessibilityLabel="Raise the price by £1"
                  className="h-12 w-12 items-center justify-center rounded-full border-[1.5px] border-white/80"
                >
                  <Icon name="plus" size={20} weight="semibold" />
                </Pressable>
              </View>
              <Text className="mt-1 text-center text-[13px] text-muted">
                Tap to type · from £10, no upper limit · pence allowed
              </Text>
              {priceNote && <Text className="mt-1 text-center text-[13px] text-warn">{priceNote}</Text>}
              {!priceTouched && (
                <Text className="mt-0.5 text-center text-[12px] text-faint">
                  Starts at the guide price for what you picked
                </Text>
              )}
              <View className="mt-3.5 gap-2 border-t border-line-strong pt-3.5">
                <View className="flex-row justify-between">
                  <Text className="text-[15px] text-ink">Customer pays</Text>
                  <Text className="text-[15px] text-ink">{pounds(price, true)}</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-[15px] text-ink">TradeSura fee (20%)</Text>
                  <Text className="text-[15px] text-ink">{pounds(fee, true)}</Text>
                </View>
                <Text className="text-[16px] font-semibold text-ok">
                  You keep {pounds(keep, true)} a month · {roundPounds(keep * 12)} a year
                </Text>
              </View>
            </Card>

            <Card>
              <SectionTitle>What you could earn</SectionTitle>
              <Slider
                value={customers}
                min={1}
                max={20}
                onChange={setCustomers}
                accessibilityLabel="Number of customers on this plan"
              />
              <Text className="text-center text-[26px] font-extrabold text-ok">
                {roundPounds(keep * 12 * customers)} a year
              </Text>
              <Text className="mt-0.5 text-center text-[13px] text-muted">
                with {customers} customer{customers === 1 ? "" : "s"} on this plan
              </Text>
            </Card>

            <Card>
              <SectionTitle>What your customer sees</SectionTitle>
              <CustomerPlanPeek
                tradingName={tradingName}
                name={name}
                priceMonthlyPence={price}
                lines={customerLines}
              />
            </Card>

            <Pressable
              onPress={() => setTipsOpen(!tipsOpen)}
              className="rounded-2xl border border-line-strong px-4 py-3.5"
            >
              <View className="flex-row items-center gap-3">
                <Icon name="bulb" size={20} />
                <Text className="flex-1 text-[16px] text-ink">Pricing tips</Text>
                <View style={{ transform: [{ rotate: tipsOpen ? "90deg" : "0deg" }] }}>
                  <Icon name="chevron" size={14} color="#9fb6d0" weight="semibold" />
                </View>
              </View>
              {tipsOpen && (
                <View className="mt-3 gap-2">
                  {[
                    "Most engineers charge £10 to £15 a month for a plan with the annual service.",
                    "Price the work, not the risk: the plan pays for the service and checks you'll actually do.",
                    "Offering 2 or 3 plans helps: customers like to pick, and many go for the middle one.",
                    "You can change the price later. Customers already on the plan keep what they signed up for.",
                  ].map((t) => (
                    <View key={t} className="flex-row gap-2">
                      <Text className="text-[14px] text-flame">•</Text>
                      <Text className="flex-1 text-[14px] leading-[20px] text-muted">{t}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Pressable>

            <View className="py-1">
              <StripeBadge caption="Collected by Direct Debit · paid out every Friday" />
            </View>
          </>
        )}

        {/* Step 3 — Name your plan */}
        {step === 3 && (
          <>
            <View>
              <Text className="text-[22px] font-bold text-ink">Name your plan</Text>
              <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
                This is the name customers see on their plan, your profile and your website. Keep it
                short and clear.
              </Text>
            </View>

            <Card>
              <SectionTitle>Plan name</SectionTitle>
              <View className="rounded-xl border border-line-strong bg-bg px-3.5 pb-2 pt-3">
                <TextInput
                  value={name}
                  onChangeText={(v) => {
                    setName(v.slice(0, NAME_MAX));
                    setBlocked(null);
                    markDirty();
                  }}
                  maxLength={NAME_MAX}
                  placeholder={`e.g. ${suggestedName}`}
                  placeholderTextColor="#6e86a3"
                  className="min-h-[44px] text-[18px] text-ink"
                />
                <Text className="text-right text-[13px] text-muted">
                  {name.length}/{NAME_MAX}
                </Text>
              </View>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {(landlordPlan ? LANDLORD_NAME_CHIPS : NAME_CHIPS).map((s) => {
                  const on = name === s;
                  return (
                    <Pressable
                      key={s}
                      onPress={() => {
                        setName(s);
                        setBlocked(null);
                        markDirty();
                      }}
                      className={`rounded-full border px-3.5 py-2 ${on ? "border-flame bg-flame" : "border-line-strong"}`}
                    >
                      <Text className={`text-[14px] ${on ? "font-semibold text-white" : "text-ink"}`}>{s}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {blocked && (
                <View className="mt-3 rounded-xl border border-warn/50 bg-warn-tint p-3">
                  <Text className="text-[13px] text-warn">{blocked.explanation}</Text>
                  <Pressable
                    onPress={() => {
                      setName(blocked.suggestion.title);
                      setBlocked(null);
                      markDirty();
                    }}
                  >
                    <Text className="mt-1 text-[13px] text-warn">
                      Try <Text className="font-semibold underline">{blocked.suggestion.title}</Text>
                    </Text>
                  </Pressable>
                </View>
              )}
            </Card>

            <Card>
              <View className="mb-2 flex-row items-center gap-2">
                <Icon name="bulb" size={20} color="#5fa3f0" />
                <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Naming tips</Text>
              </View>
              {[
                "Say what's included: Boiler Care, Landlord Care",
                "Offering more than one? Make the step up clear: Boiler Care, Boiler Care Plus, Complete Care",
                "Plans are maintenance, not insurance, so words like cover, breakdown or emergency can't be used",
                "Under 20 characters fits best on your customer's phone",
              ].map((t) => (
                <View key={t} className="flex-row gap-2.5 py-1.5">
                  <Text className="text-[15px] text-flame">•</Text>
                  <Text className="flex-1 text-[14.5px] leading-[21px] text-ink">{t}</Text>
                </View>
              ))}
            </Card>

            <Card>
              <SectionTitle>What your customer sees</SectionTitle>
              <CustomerPlanCard
                name={name || "Your plan"}
                priceMonthlyPence={price}
                lines={customerLines.slice(0, 3).map((l) => (typeof l === "string" ? l : l.title))}
                engineer={{ tradingName, verified }}
                showJoin
              />
            </Card>
          </>
        )}

        {/* Step 4 — Check your plan */}
        {step === 4 && !isEdit && (
          <>
            <View>
              <Text className="text-[22px] font-bold text-ink">Check your plan</Text>
              <Text className="mt-1.5 text-[14.5px] text-muted">This is exactly what your customers will see.</Text>
            </View>

            <CustomerPlanCard
              name={name}
              priceMonthlyPence={price}
              lines={customerLines}
              engineer={{ tradingName, verified }}
              cancelChip
              showJoin
            />

            <Card>
              <SectionTitle>Your plan</SectionTitle>
              {[
                {
                  label: `${optionCount} option${optionCount === 1 ? "" : "s"} included`,
                  to: 1 as Step,
                },
                {
                  label: `${pounds(price)} a month · you keep ${pounds(keep, true)} · ${roundPounds(keep * 12)} a year`,
                  to: 2 as Step,
                },
                { label: `Name: ${name}`, to: 3 as Step },
              ].map((row, i) => (
                <View
                  key={row.to}
                  className={`flex-row items-center justify-between gap-3 py-3.5 ${i < 2 ? "border-b border-line-strong" : ""}`}
                >
                  <Text className="flex-1 text-[15px] text-ink">{row.label}</Text>
                  <Pressable onPress={() => jumpTo(row.to)} hitSlop={10}>
                    <Text className="text-[15px] font-semibold text-flame">Edit</Text>
                  </Pressable>
                </View>
              ))}
            </Card>

            <Pressable
              onPress={() => {
                setAttested(!attested);
                setError(null);
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: attested }}
              className="flex-row items-start gap-3 px-1 py-1"
            >
              <View
                className={`mt-0.5 h-7 w-7 items-center justify-center rounded-md border-[1.5px] ${attested ? "border-flame bg-flame" : "border-white/70"}`}
              >
                {attested && <Icon name="check" size={16} color="#0f2140" weight="bold" />}
              </View>
              <Text className="flex-1 text-[15px] leading-[22px] text-ink">
                I&apos;ll provide everything in this plan to every customer on it, under the TradeSura{" "}
                <Text
                  className="text-flame"
                  onPress={() => Linking.openURL(apiUrl("/customer-terms"))}
                >
                  customer terms
                </Text>
              </Text>
            </Pressable>
          </>
        )}

        {error && <Text className="px-1 text-sm text-warn">{error}</Text>}

      </ScrollView>

      {/* Review 3 §3 — inside flows the main button sits in a sticky footer. */}
      {(isEdit || step !== 1) && (
        <SafeAreaView edges={["bottom"]} className="border-t border-line-strong bg-bg">
          <View className="px-4 py-3">
            {isEdit ? (
              <Button
                onPress={saveSingleStep}
                disabled={busy || (step === 3 && Boolean(blocked)) || (step === 1 && Boolean(serviceRuleError))}
              >
                {busy ? "Saving…" : "Save changes"}
              </Button>
            ) : (
              <Button
                onPress={goNext}
                // Review 3 — "Make this plan live" stays greyed out until ticked.
                disabled={busy || (step === 3 && Boolean(blocked)) || (step === 4 && !attested)}
              >
                {nextLabel}
              </Button>
            )}
          </View>
        </SafeAreaView>
      )}

      {step === 1 && !isEdit && (
        <SafeAreaView edges={["bottom"]} className="border-t border-line-strong bg-bg">
          <View className="flex-row items-center gap-3 px-4 py-3">
            <View className="flex-1">
              <Text className="text-[19px] font-bold text-ink">{selected.size} selected</Text>
              {selected.size > RECOMMENDED_MAX ? (
                <Text className="text-[12.5px] text-warn">Over 6 options can be a lot for customers to take in</Text>
              ) : selected.size < RECOMMENDED_MIN && !serviceRuleError ? (
                <Text className="text-[12.5px] text-muted">Most plans have 3 to 6 options</Text>
              ) : null}
              <Text className="text-[17px] font-semibold text-ok">Guide price {pounds(guide)}/mo</Text>
              <Text className="text-[13px] text-muted">You set your final price next</Text>
            </View>
            <Button onPress={goNext} disabled={busy || Boolean(serviceRuleError) || Boolean(rateError)} className="min-w-[130px]">
              {busy ? "Saving…" : "Next"}
            </Button>
          </View>
        </SafeAreaView>
      )}

      {/* R12 — confirm a qualification before switching the option on. */}
      <Modal visible={qualAsk !== null} transparent animationType="fade" onRequestClose={() => setQualAsk(null)}>
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setQualAsk(null)}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl border-t border-line-strong bg-paper px-5 pb-10 pt-4"
          >
            <View className="mb-4 h-1 w-10 self-center rounded-full bg-line-strong" />
            <Text className="text-[18px] font-bold text-ink">Confirm you&apos;re qualified for this</Text>
            <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
              {qualAsk?.title} needs the right qualification. We keep a dated record of your confirmation.
            </Text>
            <Pressable
              onPress={() => setQualTicked(!qualTicked)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: qualTicked }}
              className="mt-4 flex-row items-start gap-3"
            >
              <View
                className={`mt-0.5 h-7 w-7 items-center justify-center rounded-md border-[1.5px] ${qualTicked ? "border-flame bg-flame" : "border-white/70"}`}
              >
                {qualTicked && <Icon name="check" size={16} color="#0f2140" weight="bold" />}
              </View>
              <Text className="flex-1 text-[15px] leading-[22px] text-ink">
                {qualAsk ? qualPrompts[qualAsk.code] : ""}
              </Text>
            </Pressable>
            <Button className="mt-5" onPress={confirmQualification} disabled={!qualTicked}>
              Confirm and switch on
            </Button>
            <Pressable onPress={() => setQualAsk(null)} className="items-center py-3">
              <Text className="text-[15px] text-muted">Not now</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={info !== null} transparent animationType="fade" onRequestClose={() => setInfo(null)}>
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setInfo(null)}>
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="rounded-t-3xl border-t border-line-strong bg-paper px-5 pb-10 pt-4"
          >
            <View className="mb-4 h-1 w-10 self-center rounded-full bg-line-strong" />
            <Text className="text-[18px] font-bold text-ink">{info?.title}</Text>
            <Text className="mt-1 text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
              What your customer agrees to
            </Text>
            <Text className="mt-2 text-[15px] leading-[22px] text-ink">{info?.bodyText}</Text>
            {info && qualPrompts[info.code] && (
              <>
                <Text className="mt-4 text-[12px] font-bold uppercase tracking-[0.08em] text-muted">
                  Qualification
                </Text>
                <Text className="mt-1 text-[15px] leading-[22px] text-ink">
                  You&apos;ll be asked to confirm: {qualPrompts[info.code]}
                </Text>
              </>
            )}
            {info?.pricingLabel === RATE_LABEL && (
              <Text className="mt-4 text-[14px] leading-[21px] text-muted">
                You set the rate. It shows on your customer&apos;s plan page.
              </Text>
            )}
            <Button className="mt-5" onPress={() => setInfo(null)}>
              Got it
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
