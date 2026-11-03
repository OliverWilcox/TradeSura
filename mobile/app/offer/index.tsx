import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Linking,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams, type Href } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button } from "@/components/ui";
import { Skeleton, Bone, TextBone } from "@/components/skeleton";
import { checkEmail, checkRequired, checkUkMobile, checkUkPostcode } from "@/lib/validate";
import { formatPounds } from "@/lib/earnings";
import { isOffline, queueOffer } from "@/lib/offer-queue";

// 30 Oct update §6 — "the app does the selling". The installer taps why they
// were there (required), then hands over the phone ("Show them now", the main
// way) or sends the link to the customer's own phone. Everything the
// customer sees is tailored to the reason. The list comes from Matt's admin
// (GET /api/visit-reasons); this is the fallback when there's no signal.
const FALLBACK_REASONS = [
  { reason: "new_boiler", label: "New boiler fitted" },
  { reason: "breakdown", label: "Breakdown / repair" },
  { reason: "yearly_service", label: "Yearly service" },
  { reason: "landlord", label: "Landlord safety check" },
  { reason: "other", label: "Other work" },
];
type Reason = { reason: string; label: string };

// The script card, then the send card: plan pills, book/new toggle and a
// few customer rows.
function OfferSkeleton() {
  return (
    <Skeleton label="Loading your customers and plans" className="gap-3.5 px-4 pt-4">
      <Bone height={50} radius={16} />
      <Card>
        <TextBone width={120} size={14} style={{ marginBottom: 8 }} />
        <View className="mb-3 flex-row gap-2">
          <Bone width={104} height={28} radius={14} />
          <Bone width={96} height={28} radius={14} />
        </View>
        {[150, 180, 130, 165].map((w, i) => (
          <View
            key={w}
            className={`flex-row items-center justify-between py-2.5 ${i < 3 ? "border-b border-line-soft" : ""}`}
          >
            <TextBone width={w} size={14} />
            <Bone width={14} height={14} radius={7} />
          </View>
        ))}
      </Card>
    </Skeleton>
  );
}

type Customer = { id: string; firstName: string; lastName: string; phone: string };
type Tier = { id: string; name: string; priceMonthlyPence: number; lines: string[] };

// Built from the selected plan: its own price, and the service line only when
// the plan includes it (Build Review 2, ruling 2 — service is optional).
function offerScript(tier: Tier | null): string {
  const price = tier ? `£${(tier.priceMonthlyPence / 100).toFixed(2).replace(/\.00$/, "")} a month` : "a small monthly fee";
  const service = !tier || tier.lines.some((l) => /annual boiler service/i.test(l));
  // 30 Oct §6 — the app does the selling: one line, then hand the phone over.
  return `“I put all my customers on a care plan now — ${price} and you’re first in my diary.${service ? " Your annual service comes with it once your third payment’s gone through." : ""} Have a quick look, it’s all on here.”`;
}

// Thumb-sized, size-only text class (see components/address-lookup.tsx).
const inputCls = "min-h-[48px] rounded-[10px] border bg-paper px-3.5 font-sans text-[16px] text-ink";

type FormErrors = Partial<Record<"firstName" | "lastName" | "phone" | "email" | "postcode" | "customer", string | null>>;

// Opens WhatsApp with the message ready; false when it isn't installed.
// openURL (not canOpenURL, which iOS answers "no" for undeclared schemes)
// rejects when nothing on the phone handles whatsapp://.
async function openWhatsApp(message: string): Promise<boolean> {
  try {
    await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`);
    return true;
  } catch {
    return false;
  }
}

// An offer the customer didn't get: our text was refused, or WhatsApp isn't
// on this phone. The plan exists; the link just needs to go another way.
type Unsent = { planId: string; link: string; message: string; name: string; next: Href; why: "text" | "whatsapp" };

function FieldError({ children }: { children?: string | null }) {
  return children ? <Text className="mt-1 font-sans text-[13px] text-danger">{children}</Text> : null;
}

export default function OfferStart() {
  const { me } = useAuth();
  const { customerId: customerIdParam } = useLocalSearchParams<{ customerId?: string }>();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [tierCount, setTierCount] = useState<number | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [scriptOpen, setScriptOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    addressLine1: "",
    town: "",
    postcode: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [reasons, setReasons] = useState<Reason[]>(FALLBACK_REASONS);
  const [reason, setReason] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [showBusy, setShowBusy] = useState(false);
  const [queuedFor, setQueuedFor] = useState<string | null>(null);
  const [unsent, setUnsent] = useState<Unsent | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{
        customers: Customer[];
        tierCount: number;
        offersSent: number;
        tiers: Tier[];
      }>("/api/offer");
      setCustomers(data.customers);
      setTierCount(data.tierCount);
      setTiers(data.tiers);
      setTierId((current) => current ?? data.tiers[0]?.id ?? null);
      setScriptOpen(data.offersSent < 10);
      const preselect =
        customerIdParam && data.customers.some((c) => c.id === customerIdParam)
          ? customerIdParam
          : data.customers[0]?.id ?? null;
      setMode(preselect ? "existing" : data.customers.length ? "existing" : "new");
      setCustomerId(preselect);
      setLoadError(null);
      api<{ reasons: Reason[] }>("/api/visit-reasons")
        .then((r) => r.reasons.length && setReasons(r.reasons))
        .catch(() => {});
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load your book.");
    }
  }, [customerIdParam]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function setField(key: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [key]: v }));
    setErrors((e) => ({ ...e, [key]: null }));
  }

  function needReason(): boolean {
    if (reason) return false;
    setReasonError("Tap why you were there first.");
    return true;
  }

  // "Show them now" — the customer joins on this phone, on a page tailored
  // to the reason; the review follows.
  async function showNow() {
    if (needReason()) return;
    setShowBusy(true);
    setError(null);
    try {
      const s = await api<{ token: string; path: string }>("/api/offer/session", {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      router.push({ pathname: "/offer/show", params: { token: s.token, path: s.path } });
    } catch (e) {
      setError(
        isOffline(e)
          ? "No signal to open your plan page here. Use Send to their phone: we'll text the link once you're back online."
          : e instanceof ApiError
            ? e.message
            : "Couldn't open your plan page.",
      );
    } finally {
      setShowBusy(false);
    }
  }

  async function send(channel: "sms" | "whatsapp") {
    if (!tierId || needReason()) return;
    // Never a silent grey button — say what's missing (29 Sept review).
    const found: FormErrors =
      mode === "existing"
        ? { customer: customerId ? null : "Pick a customer to send the offer to." }
        : {
            firstName: checkRequired(form.firstName, "customer's first name"),
            lastName: checkRequired(form.lastName, "customer's last name"),
            phone: checkUkMobile(form.phone),
            email: form.email.trim() ? checkEmail(form.email) : null,
            postcode: form.postcode.trim() ? checkUkPostcode(form.postcode) : null,
          };
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    setBusy(true);
    setError(null);
    try {
      const base =
        mode === "existing" ? { customerId } : { ...form, email: form.email || undefined };
      const data = await api<{
        planId: string;
        link: string;
        message: string;
        customerFirstName: string;
        sessionToken: string | null;
        // Our text: "not_sent" when Twilio refused it or texts aren't set up.
        text?: "sent" | "not_sent" | null;
      }>("/api/offer", { method: "POST", body: JSON.stringify({ ...base, tierId, channel, reason }) });
      // Plans first, then the review — every customer, joined or not.
      const next: Href = data.sessionToken
        ? { pathname: "/offer/review", params: { token: data.sessionToken, planId: data.planId } }
        : `/offer/${data.planId}`;
      const missed = { planId: data.planId, link: data.link, message: data.message, name: data.customerFirstName, next };
      if (channel === "whatsapp" && !(await openWhatsApp(data.message))) {
        reportWhatsAppFailed(data.planId);
        setUnsent({ ...missed, why: "whatsapp" });
      } else if (data.text === "not_sent") {
        setUnsent({ ...missed, why: "text" });
      } else {
        router.push(next);
      }
    } catch (e) {
      if (isOffline(e) && reason) {
        // §6.7 — no signal: keep the details and text the link later. No error screen.
        await queueOffer({
          reason,
          tierId,
          ...(mode === "existing" ? { customerId } : { ...form }),
        });
        setQueuedFor(previewName);
      } else setError(e instanceof ApiError ? e.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  }

  function reportWhatsAppFailed(planId: string) {
    api(`/api/offer/${planId}/failed`, { method: "POST", body: JSON.stringify({ channel: "whatsapp" }) }).catch(() => {});
  }

  async function resendOnWhatsApp(u: Unsent) {
    if (await openWhatsApp(u.message)) {
      router.push(u.next);
      return;
    }
    reportWhatsAppFailed(u.planId);
    setUnsent({ ...u, why: "whatsapp" });
  }

  async function copyLink(link: string) {
    await Clipboard.setStringAsync(link);
    setCopied(true);
  }

  const previewName =
    mode === "existing"
      ? customers?.find((c) => c.id === customerId)?.firstName ?? "there"
      : form.firstName || "there";
  const brandLabel = me?.tradingName ?? "your engineer";
  const linkPreview = me?.slug ? `tradesura.com/${me.slug}` : "your plan link";
  const selectedTier = tiers?.find((t) => t.id === tierId) ?? null;

  const shown = customers ? (showAll ? customers : customers.slice(0, 8)) : [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Offer a plan" />
      </SafeAreaView>

      {loadError ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="font-sans text-sm text-danger">{loadError}</Text>
          <Button onPress={load} variant="ghost" className="w-full">
            Try again
          </Button>
        </View>
      ) : customers === null || tierCount === null ? (
        <OfferSkeleton />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
          {tierCount > 0 && (
            // Amber means "pending" in the design system; a script isn't, so
            // this is a plain card with the blue link colour.
            <Card>
              <Pressable
                onPress={() => setScriptOpen((v) => !v)}
                className="flex-row items-center justify-between"
                accessibilityRole="button"
              >
                <Micro className="text-flame">What to say</Micro>
                <Text className="font-sans text-[13px] font-semibold text-flame">{scriptOpen ? "Hide" : "Show"}</Text>
              </Pressable>
              {scriptOpen && (
                <Text className="mt-2 font-sans text-[14px] leading-[21px] text-ink">{offerScript(selectedTier)}</Text>
              )}
            </Card>
          )}

          {tierCount === 0 ? (
            // 29 Sept review — this used to be one line with an inline link
            // nested in Text that didn't respond to taps. A real empty state
            // with a real button, straight into the plan builder.
            <Card>
              <Micro>Before your first offer</Micro>
              <Text className="mt-1.5 text-[19px] font-bold text-ink">Build your plan first</Text>
              <Text className="mt-1 text-[14px] leading-5 text-muted">
                Customers pick from your plan when they open the link. We&apos;ve drafted Boiler
                Care at £12/month — approve it or set your own price. Takes about a minute.
              </Text>
              <Button className="mt-4" onPress={() => router.push("/plans")}>
                Build my plan
              </Button>
            </Card>
          ) : !me?.gasSafeVerifiedAt ? (
            // Build Guide v2 Part 6.5 LAW — the two-leg gate: sending an
            // offer needs a live plan AND the badge, not plan-only.
            <Card>
              <Micro>Almost there</Micro>
              <Text className="mt-1.5 text-[17px] font-bold text-warn">
                Unlocks when your Gas Safe check is done (usually within 24 hours)
              </Text>
              <Text className="mt-1 text-[14px] leading-5 text-muted">
                We&apos;ll send a push and an email the moment you&apos;re verified. Your plan is
                ready to go then.
              </Text>
              <Button variant="ghost" className="mt-4" onPress={() => router.push("/more")}>
                Check my status
              </Button>
              <Button variant="ghost" className="mt-2" onPress={() => router.push("/demo")}>
                Try it in demo mode
              </Button>
            </Card>
          ) : !me?.stripeConnected ? (
            <Card>
              <Micro>One more step</Micro>
              <Text className="mt-1.5 text-[17px] font-bold text-warn">Set up payments first</Text>
              {me?.role === "staff" ? (
                <Text className="mt-1 text-[14px] leading-5 text-muted">
                  Customers can&apos;t join until the business owner finishes payment setup — ask them to
                  do it from their app.
                </Text>
              ) : (
                <>
                  <Text className="mt-1 text-[14px] leading-5 text-muted">
                    Customers pay you by Direct Debit through Stripe. Until your payment setup is
                    done, they can&apos;t join — so finish it before sending an offer.
                  </Text>
                  <Button className="mt-4" onPress={() => router.push("/get-paid")}>
                    Set up payments
                  </Button>
                  <Button variant="ghost" className="mt-2" onPress={() => router.push("/demo")}>
                    Try it in demo mode
                  </Button>
                </>
              )}
            </Card>
          ) : unsent ? (
            <Card>
              <Micro className="text-warn">Not sent</Micro>
              <Text className="mt-1.5 text-[19px] font-bold text-ink">
                {unsent.why === "text" ? `Our text to ${unsent.name} didn't go` : "WhatsApp isn't on this phone"}
              </Text>
              <Text className="mt-1 text-[14px] leading-5 text-muted">
                {unsent.why === "text"
                  ? "Their plan is ready. Send them the link another way."
                  : `Their plan is ready. Copy the link and send it to ${unsent.name} another way.`}
              </Text>
              {unsent.why === "text" && (
                <Button className="mt-4" onPress={() => resendOnWhatsApp(unsent)}>
                  Send on WhatsApp
                </Button>
              )}
              <Button
                variant={unsent.why === "text" ? "ghost" : "flame"}
                className={unsent.why === "text" ? "mt-2" : "mt-4"}
                onPress={() => copyLink(unsent.link)}
              >
                {copied ? "Link copied" : "Copy the link"}
              </Button>
              <Button variant="ghost" className="mt-2" onPress={() => router.push(unsent.next)}>
                Continue
              </Button>
            </Card>
          ) : queuedFor ? (
            // §6.7 — no signal: saved, sent automatically later. Not an error.
            <Card>
              <Micro>Saved</Micro>
              <Text className="mt-1.5 text-[19px] font-bold text-ink">We&apos;ll text {queuedFor} the link</Text>
              <Text className="mt-1 text-[14px] leading-5 text-muted">
                No signal here. Their details are saved on your phone, and the link goes out by text as soon
                as you&apos;re back online.
              </Text>
              <Button className="mt-4" onPress={() => router.replace("/")}>
                Done
              </Button>
            </Card>
          ) : (
            <>
            <Card>
              <Text className="font-semibold text-[15px] text-ink">Why were you there today?</Text>
              <Text className="mt-0.5 text-[12.5px] text-muted">
                Your plan page is written for it, so you just hand the phone over.
              </Text>
              <View className="mt-3 flex-row flex-wrap gap-2">
                {reasons.map((r) => (
                  <Pressable
                    key={r.reason}
                    testID={`reason-${r.reason}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: reason === r.reason }}
                    onPress={() => {
                      setReason(r.reason);
                      setReasonError(null);
                    }}
                    className={`min-h-[44px] justify-center rounded-full px-4 ${reason === r.reason ? "bg-flame" : "border border-line bg-panel"}`}
                  >
                    <Text className={`font-semibold text-[14px] ${reason === r.reason ? "text-iron" : "text-ink"}`}>
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <FieldError>{reasonError}</FieldError>
            </Card>

            <Card>
              <Button onPress={showNow} disabled={showBusy}>
                {showBusy ? "Opening…" : "Show them now"}
              </Button>
              <Text className="mt-1.5 text-center text-[12px] text-muted">
                They join on your phone, then you ask for a review.
              </Text>
              {!sendOpen && (
                <Button
                  variant="ghost"
                  className="mt-3"
                  onPress={() => {
                    if (!needReason()) setSendOpen(true);
                  }}
                >
                  Send to their phone
                </Button>
              )}
              {error && !sendOpen && <Text className="mt-2 font-sans text-sm text-danger">{error}</Text>}
            </Card>

            {sendOpen && (
            <Card>
              <Text className="mb-2 font-semibold text-sm text-ink">Send to their phone</Text>

              {/* Build Guide v2 Part 9.2 — "Pick the customer, pick the
                  plan, see the exact text, send." */}
              {tiers && tiers.length > 1 && (
                <View className="mb-3 flex-row flex-wrap gap-1.5">
                  {tiers.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => setTierId(t.id)}
                      className={`rounded-full px-3 py-1.5 ${tierId === t.id ? "bg-flame-tint" : "border border-line bg-panel"}`}
                    >
                      <Text
                        className={`tabular-nums font-medium text-xs ${tierId === t.id ? "text-flame-deep" : "text-faint"}`}
                      >
                        {t.name} · {formatPounds(t.priceMonthlyPence)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {customers.length > 0 && (
                <View className="mb-3 flex-row gap-2">
                  <Pressable
                    onPress={() => setMode("existing")}
                    className={`rounded-full px-3 py-1.5 ${mode === "existing" ? "bg-flame-tint" : "border border-line bg-panel"}`}
                  >
                    <Text
                      className={`tabular-nums font-medium text-xs ${mode === "existing" ? "text-flame-deep" : "text-faint"}`}
                    >
                      From my book
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMode("new")}
                    className={`rounded-full px-3 py-1.5 ${mode === "new" ? "bg-flame-tint" : "border border-line bg-panel"}`}
                  >
                    <Text
                      className={`tabular-nums font-medium text-xs ${mode === "new" ? "text-flame-deep" : "text-faint"}`}
                    >
                      New customer
                    </Text>
                  </Pressable>
                </View>
              )}

              {mode === "existing" ? (
                customers.length === 0 ? (
                  <Text className="font-sans text-sm text-muted">
                    No customers in your book yet — switch to &ldquo;New customer&rdquo; above.
                  </Text>
                ) : (
                  <View>
                    {shown.map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => {
                          setCustomerId(c.id);
                          setErrors((e) => ({ ...e, customer: null }));
                        }}
                        className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
                      >
                        <Text className="font-sans text-sm text-ink">
                          {c.firstName} {c.lastName} · {c.phone}
                        </Text>
                        <Text className={`font-bold ${customerId === c.id ? "text-flame" : "text-line"}`}>
                          {customerId === c.id ? "●" : "○"}
                        </Text>
                      </Pressable>
                    ))}
                    {!showAll && customers.length > 8 && (
                      <Pressable onPress={() => setShowAll(true)} className="pt-2.5">
                        <Text className="text-center font-semibold text-sm text-flame-deep">
                          View all {customers.length} customers →
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )
              ) : (
                <View className="gap-2">
                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <TextInput
                        placeholder="First name"
                        placeholderTextColor="#6e86a3"
                        value={form.firstName}
                        onChangeText={(v) => setField("firstName", v)}
                        className={`${inputCls} ${errors.firstName ? "border-danger" : "border-line"}`}
                      />
                      <FieldError>{errors.firstName}</FieldError>
                    </View>
                    <View className="flex-1">
                      <TextInput
                        placeholder="Last name"
                        placeholderTextColor="#6e86a3"
                        value={form.lastName}
                        onChangeText={(v) => setField("lastName", v)}
                        className={`${inputCls} ${errors.lastName ? "border-danger" : "border-line"}`}
                      />
                      <FieldError>{errors.lastName}</FieldError>
                    </View>
                  </View>
                  <View>
                    <TextInput
                      placeholder="Mobile (07…)"
                      placeholderTextColor="#6e86a3"
                      keyboardType="phone-pad"
                      value={form.phone}
                      onChangeText={(v) => setField("phone", v)}
                      className={`${inputCls} ${errors.phone ? "border-danger" : "border-line"}`}
                    />
                    <FieldError>{errors.phone}</FieldError>
                  </View>
                  <View>
                    <TextInput
                      placeholder="Email (for the plan document)"
                      placeholderTextColor="#6e86a3"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={form.email}
                      onChangeText={(v) => setField("email", v)}
                      className={`${inputCls} ${errors.email ? "border-danger" : "border-line"}`}
                    />
                    <FieldError>{errors.email}</FieldError>
                  </View>
                  <View className="flex-row gap-2">
                    <TextInput
                      placeholder="Address line 1"
                      placeholderTextColor="#6e86a3"
                      value={form.addressLine1}
                      onChangeText={(v) => setField("addressLine1", v)}
                      className={`flex-1 ${inputCls} border-line`}
                    />
                    <TextInput
                      placeholder="Postcode"
                      placeholderTextColor="#6e86a3"
                      autoCapitalize="characters"
                      value={form.postcode}
                      onChangeText={(v) => setField("postcode", v)}
                      className={`w-28 ${inputCls} ${errors.postcode ? "border-danger" : "border-line"}`}
                    />
                  </View>
                  <FieldError>{errors.postcode}</FieldError>
                  <Pressable onPress={() => router.push("/plans")} className="pt-1">
                    <Text className="font-semibold text-xs text-flame-deep">Manage my plans →</Text>
                  </Pressable>
                </View>
              )}

              {/* Part 18 — the offer text template, verbatim: "Hi {first
                  name} — {engineer first name} from {trading name}. My
                  {plan name} plan is £{X} a month: {benefits, lower case,
                  comma-run}. Sign up here — takes a minute: {personal
                  link}" — server sends this exact text; this previews it. */}
              <Micro className="mb-1.5 mt-3">Their message</Micro>
              <View className="rounded-[14px] rounded-bl-[4px] bg-flame-tint p-3">
                <Text className="font-sans text-[12.5px] text-ink">
                  Hi {previewName} — {me?.firstName ?? brandLabel} from {brandLabel}. My{" "}
                  {selectedTier?.name ?? "plan"} plan is £
                  {selectedTier ? (selectedTier.priceMonthlyPence / 100).toFixed(2).replace(/\.00$/, "") : "—"}{" "}
                  a month: {selectedTier?.lines.map(lowerFirst).join(", ") ?? ""}. Sign up
                  here — takes a minute:{" "}
                  <Text className="font-semibold text-flame-deep">{linkPreview}</Text>
                </Text>
              </View>

              <FieldError>{errors.customer}</FieldError>
              {error && <Text className="mt-2 font-sans text-sm text-danger">{error}</Text>}
              <View className="mt-3 flex-row gap-2">
                <Button
                  onPress={() => send("sms")}
                  disabled={busy}
                  className="flex-1"
                >
                  {busy ? "Sending…" : "Send by text"}
                </Button>
                <Button
                  onPress={() => send("whatsapp")}
                  disabled={busy}
                  className="flex-1"
                >
                  WhatsApp
                </Button>
              </View>
              <Micro className="mt-2 text-center">
                We&apos;ll follow up with {previewName}{" "}after 2 and 7 days if they haven&apos;t joined.
              </Micro>
            </Card>
            )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// Mirrors app/api/offer's message: the opening word lower-cased only, so
// "CO alarm" and "TRVs" survive.
function lowerFirst(line: string): string {
  const first = line.split(/\s/)[0] ?? "";
  return /^[A-Z0-9]{2,}/.test(first) ? line : line.charAt(0).toLowerCase() + line.slice(1);
}
