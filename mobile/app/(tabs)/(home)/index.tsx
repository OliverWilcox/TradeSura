import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError, getHasSeenFirstCustomer, getPushPrompted, setPushPrompted } from "@/lib/api";
import { pushPermission, registerForPush } from "@/lib/push";
import { useAuth } from "@/lib/auth-context";
import { StaffHome } from "@/components/staff-home";
import { AppHeader, Card, Micro, Button, GateSheet } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { RingProgress, payoutWeekProgress } from "@/components/ring-progress";
import { RingMark } from "@/components/ring-mark";
import { Skeleton, Bone, TextBone } from "@/components/skeleton";
import { setupSteps } from "@/lib/setup-steps";
import { offerLock } from "@/lib/offer-lock";
import { StripeStatusCard } from "@/components/stripe-status-card";
import { GrowthCard } from "@/components/growth-card";

type DueItem = {
  customerId: string;
  customerName: string;
  dueDate: string;
  onPlan: boolean;
  tierName?: string;
  hasCp12: boolean;
  planId?: string;
};

type Standing = { state: string; tone: "amber" | "red" | "quiet"; text: string };

type Dashboard = {
  totalPence: number;
  count: number;
  offersOut: number;
  newThisMonth: number;
  failedRecently: number;
  noPlan: number;
  prizeYearlyPence: number;
  upcoming: DueItem[];
  nextPayoutPence: number | null;
  nextPayoutDate: string | null;
  referral: { name: string; ratePercent: number } | null;
  emergencies: number;
  offersWaiting: { customerFirstName: string; planId: string } | null;
  standing: Standing;
  firstMember?: { planId: string; customerFirstName: string; planName: string; yearlyPence: number } | null;
};

// Build Guide v2 Part 6.4 — the standing strip: permanent infrastructure,
// visible even when everything is healthy, one component reading the one
// truth source (lib/verification-state.ts). Every state routes through to
// the Account status row.
function StandingStrip({ standing }: { standing: Standing }) {
  const toneCls =
    standing.tone === "red"
      ? "border-danger-tint bg-danger-tint"
      : standing.tone === "amber"
        ? "border-warn-tint bg-warn-tint"
        : "border-line bg-transparent";
  const textCls =
    standing.tone === "red" ? "text-danger" : standing.tone === "amber" ? "text-warn" : "text-muted";
  return (
    <Pressable onPress={() => router.push("/more")} className={`flex-row items-center gap-2.5 rounded-xl border px-3.5 py-2.5 ${toneCls}`}>
      {standing.tone === "quiet" && <Icon name="verified" size={14} color="#3dd68c" />}
      {standing.tone === "amber" && <Icon name="clock" size={16} color="#F5B544" />}
      {standing.tone === "red" && <Icon name="warning" size={14} color="#ff6b6b" />}
      <Text className={`flex-1 font-sans text-[13px] ${textCls}`} numberOfLines={2}>
        {standing.text}
      </Text>
    </Pressable>
  );
}

// 29 Sept review — "Morning, Matt" style, not a bare "Hello".
function greeting(firstName: string | null | undefined): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening";
  return firstName ? `${part}, ${firstName}` : `Good ${part.toLowerCase()}`;
}

// Part 6.5 — outlined quick-action tile with a real icon. Gated tiles stay
// visible, muted and tappable (the tap explains why).
function QuickAction({
  icon,
  label,
  onPress,
  muted = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  muted?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`min-h-[52px] flex-1 flex-row items-center gap-3 rounded-xl border border-line-strong px-3.5 py-3 ${muted ? "opacity-40" : ""}`}
    >
      <Icon name={icon} size={18} />
      <Text className="shrink text-[14px] text-ink" numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

// Stands in for strip → money card → action card → Today → tiles, box for
// box, so the real dashboard lands without anything shifting.
function DashboardSkeleton() {
  return (
    <Skeleton label="Loading your dashboard" className="gap-3.5">
      <Bone height={42} radius={12} />
      <Card variant="hero">
        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <TextBone width={110} size={11} />
            <View className="mt-1.5 h-12 justify-center">
              <Bone width={150} height={38} radius={8} />
            </View>
            <TextBone width="80%" size={14} style={{ marginTop: 4 }} />
          </View>
          <View className="items-center">
            <Bone width={72} height={72} radius={36} />
            <TextBone width={70} size={11} style={{ marginTop: 8 }} />
            <TextBone width={56} size={14} />
          </View>
        </View>
      </Card>
      <Card>
        <TextBone width={80} size={11} />
        <TextBone width="70%" size={19} style={{ marginTop: 6 }} />
        <TextBone width="90%" size={14} style={{ marginTop: 4 }} />
        <Bone height={48} radius={12} style={{ marginTop: 16 }} />
      </Card>
      <Card>
        <TextBone width={50} size={11} style={{ marginBottom: 4 }} />
        <TextBone width="85%" size={13} style={{ marginVertical: 6 }} />
      </Card>
      <View className="flex-row gap-2.5">
        <Bone height={52} radius={12} style={{ flex: 1 }} />
        <Bone height={52} radius={12} style={{ flex: 1 }} />
      </View>
      <View className="flex-row gap-2.5">
        <Bone height={52} radius={12} style={{ flex: 1 }} />
        <Bone height={52} radius={12} style={{ flex: 1 }} />
      </View>
    </Skeleton>
  );
}

// Screen 02 — the money mirror. Part 6.1 LAW: header → greeting → standing
// strip → money card → action card → Today → quick actions. Nothing may
// appear above the money card except the header, greeting and the strip.
// Build Review 2, section 8 — staff get their own cut-down Home (no £).
export default function Home() {
  const { me } = useAuth();
  return me?.role === "staff" ? <StaffHome /> : <OwnerHome />;
}

function OwnerHome() {
  const { me, refreshMe } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [plansGateOpen, setPlansGateOpen] = useState(false);
  const [shopGateOpen, setShopGateOpen] = useState(false);
  const [offerGate, setOfferGate] = useState<string | null>(null);
  const [pushAskOpen, setPushAskOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Dashboard>("/api/dashboard");
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  // The profile (`me`) drives the setup card, gates and greeting. It's
  // loaded once at sign-in, so re-read it on every visit — otherwise a plan
  // published or a badge granted since then still reads as missing.
  useFocusEffect(
    useCallback(() => {
      load();
      refreshMe();
    }, [load, refreshMe]),
  );

  // Review 3 §3 — celebrate the first customer once, ever. The screen sets
  // the flag itself, so arriving there from the push counts too.
  useEffect(() => {
    const m = data?.firstMember;
    if (!m) return;
    let cancelled = false;
    getHasSeenFirstCustomer().then((seen) => {
      if (seen || cancelled) return;
      router.push({
        pathname: "/first-customer",
        params: {
          name: m.customerFirstName,
          plan: m.planName,
          yearlyPence: String(m.yearlyPence),
          planId: m.planId,
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [data?.firstMember]);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), refreshMe()]);
    setRefreshing(false);
  }

  const awake = Boolean(me?.hasPlan);
  const verified = Boolean(me?.gasSafeVerifiedAt);

  // Part 11 — push permission is asked after the first plan goes live, behind
  // our own pre-prompt so the one-shot OS dialog only follows a yes. Already
  // granted: re-register quietly, since Expo tokens can rotate.
  useEffect(() => {
    if (!awake) return;
    let cancelled = false;
    (async () => {
      const status = await pushPermission();
      if (cancelled) return;
      if (status === "granted") registerForPush(false);
      else if (status === "undetermined" && !(await getPushPrompted()) && !cancelled) {
        setPushAskOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [awake]);

  // Part 5 — the dashboard's "Finish setup — N of 7 done" card reads the
  // same steps as the Getting started hub (lib/setup-steps.ts).
  const steps = setupSteps(me);
  const setupDone = steps.filter((x) => x.done).length;
  const nextStep = steps.find((x) => !x.done && !x.pending && !x.locked) ?? steps.find((x) => !x.done);
  const waitingLine = nextStep ? `Next: ${nextStep.title.toLowerCase()}.` : "";
  const essentialsDone = steps.filter((x) => x.key === "plan" || x.key === "paid").every((x) => x.done);

  // Review 3 — the offer lock: a live plan, the Gas Safe check AND payments.
  const lock = offerLock(me ? { ...me, hasPlan: awake } : me);
  const offerBlockedBy = lock?.reason ?? null;
  // Review 4 — "Send your first offer" only once the engineer is live (offers
  // unlocked), so it never sits under "Finish setup" as a second Get started.
  const firstOffer = Boolean(data && essentialsDone && !lock && data.count === 0);

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-paper">
        <AppHeader />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text className="text-[22px] font-extrabold tracking-tight text-ink">
          {greeting(me?.firstName)}
        </Text>
        <Text className="-mt-2 text-sm text-muted">
          {awake
            ? "Offer a plan at the end of the job — most take under 90 seconds."
            : "Once you're set up, offering a plan takes under 90 seconds."}
        </Text>

        {data && <StandingStrip standing={data.standing} />}
        {/* Signed up with "I'll add my ID photo later" (30 Sept build notes). */}
        {me && me.hasGasSafeCard === false && !verified && (
          <Pressable
            onPress={() => router.push("/add-id")}
            className="flex-row items-center gap-2.5 rounded-xl border border-warn-tint bg-warn-tint px-3.5 py-3"
          >
            <Icon name="camera" size={16} color="#F5B544" />
            <Text className="flex-1 text-[13.5px] font-semibold text-warn">
              Photo needed · Add your Gas Safe ID
            </Text>
            <Icon name="chevron" size={13} color="#F5B544" weight="semibold" />
          </Pressable>
        )}

        {loading && !data && !error && <DashboardSkeleton />}

        {error && <Text className="text-sm text-danger">{error}</Text>}
        {data && (
          <>
            {/* Part 6.2/6.3 LAW — one hero number, nothing else on this card;
                the ring is dormant until the first live plan, then it wakes
                and draws in the payout week's progress. */}
            <Card variant="hero">
              <View className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Micro>Your plan income</Micro>
                  <Text className="mt-1.5 text-[44px] font-extrabold leading-[48px] text-copper">
                    £{(data.totalPence / 100).toFixed(0)}
                    <Text className="text-[18px] font-medium text-muted"> /month</Text>
                  </Text>
                  <Text className="mt-1 text-[14px] text-muted">
                    {/* Inactive copy only until a plan is live (Part 6.2) — a
                        live plan with no signups yet already counts as active. */}
                    {!awake
                      ? "Your first plan changes this"
                      : data.count === 0 && data.offersOut === 0
                        ? lock
                          ? "Plan ready — offers unlock once your Gas Safe check and payments are done"
                          : "Your plan is live — offer it at your next job"
                        : `${data.count} plan${data.count === 1 ? "" : "s"} live · ${data.offersOut} offer${data.offersOut === 1 ? "" : "s"} out`}
                  </Text>
                </View>
                {/* Part 6.3 — the ring lives on the right from day one:
                    dormant = the whole mark at ~35% opacity, static; wakes
                    with the first live plan and fills through the week. */}
                <View className="items-center">
                  {awake ? (
                    <RingProgress size={72} strokeWidth={9} progress={payoutWeekProgress()} />
                  ) : (
                    <View style={{ opacity: 0.35 }}>
                      <RingMark size={72} />
                    </View>
                  )}
                  <Text className="mt-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                    {awake && data.nextPayoutPence !== null ? "Next payout" : "Paid every"}
                  </Text>
                  <Text className="text-[14px] font-semibold text-ink">
                    {awake && data.nextPayoutPence !== null ? (
                      <Text className="text-copper">
                        £{(data.nextPayoutPence / 100).toFixed(2)}
                        {data.nextPayoutDate
                          ? ` · ${new Date(data.nextPayoutDate).toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/London" })}`
                          : ""}
                      </Text>
                    ) : (
                      "Friday"
                    )}
                  </Text>
                </View>
              </View>
            </Card>

            {/* Part 6.6 — the action cards: Finish setup, then the first
                offer once the plan and payments are done. */}
            {/* Review 3 — a half-finished Stripe set-up is never a reset. */}
            <StripeStatusCard state={me?.stripeState} />

            {/* Review 3 P0 — an unfinished wizard draft resumes here. */}
            {me?.role !== "staff" && me?.draftPlan && (
              <Card>
                <Micro>Draft saved</Micro>
                <Text className="mt-1.5 text-[19px] font-bold text-ink">Finish your plan</Text>
                <Text className="mt-1 text-[14px] text-muted">
                  {me.draftPlan.name ? `${me.draftPlan.name} is` : "Your plan is"} saved as a draft. Pick up where you left off.
                </Text>
                <Button
                  className="mt-4"
                  onPress={() => router.push({ pathname: "/plan-wizard", params: { tierId: me.draftPlan!.id } })}
                >
                  Finish my plan
                </Button>
              </Card>
            )}

            {/* The setup card stays until all seven steps are done (Review 3:
                "Skip setup" → Home, where "Finish setup" brings them back). */}
            {me?.role !== "staff" && setupDone < steps.length && (
              <Card>
                {/* Review 4 — one "Get started" card: once the first offer
                    card shows, this one is just the remaining steps. */}
                <Micro>{firstOffer ? "Next steps" : "Get started"}</Micro>
                <Text className="mt-1.5 text-[19px] font-bold text-ink">
                  Finish setup — {setupDone} of {steps.length} done
                </Text>
                <Text className="mt-1 text-[14px] text-muted">{waitingLine}</Text>
                <Button className="mt-4" onPress={() => router.push("/onboarding")}>
                  Continue setup
                </Button>
              </Card>
            )}
            {firstOffer && (
              <Card>
                <Micro>Get started</Micro>
                <Text className="mt-1.5 text-[19px] font-bold text-ink">Send your first offer</Text>
                <Text className="mt-1 text-[14px] text-muted">
                  One customer on a plan and this card becomes your income.
                </Text>
                <Button
                  className={`mt-4 ${offerBlockedBy ? "opacity-40" : ""}`}
                  onPress={() => (offerBlockedBy ? setOfferGate(offerBlockedBy) : router.push("/offer"))}
                >
                  Offer a plan
                </Button>
              </Card>
            )}

            {data.noPlan >= 5 && (
              <Card className="border-[rgba(242,184,75,.3)] bg-warn-tint">
                <View className="flex-row items-center justify-between">
                  <View className="shrink">
                    <Text className="tabular-nums font-bold text-warn">
                      £{(data.prizeYearlyPence / 100).toFixed(0)}/yr not collected
                    </Text>
                    <Text className="mt-0.5 text-[12.5px] text-muted">
                      {data.noPlan}{" "}book customers aren&apos;t on a plan yet
                    </Text>
                  </View>
                  <Pressable onPress={() => router.push("/customers")}>
                    <Text className="font-bold text-warn">View →</Text>
                  </Pressable>
                </View>
              </Card>
            )}

            {/* Part 6.6 — the offers-waiting card is a state, not furniture:
                it appears once per offer, ever, then goes quiet. */}
            {data.offersWaiting && (
              <Card>
                <Micro>Still open</Micro>
                <Text className="mt-1 text-[15px] font-bold text-ink">
                  {data.offersWaiting.customerFirstName}{" "}hasn&apos;t set up their plan yet
                </Text>
                <Text className="mt-1 text-[12.5px] text-muted">
                  Worth a follow-up call — the link is still live.
                </Text>
              </Card>
            )}

            <Card>
              <Micro className="mb-1">Today</Micro>
              {data.upcoming.length > 0 && (
                <Pressable
                  className="flex-row gap-2 py-1.5"
                  onPress={() => router.push("/(tabs)/jobs")}
                >
                  <Icon name="service" size={18} color="#9fb6d0" />
                  <Text className="flex-1 text-[13px] text-ink">
                    <Text className="font-bold">
                      {data.upcoming.length} service{data.upcoming.length === 1 ? "" : "s"} due
                    </Text>{" "}
                    — {data.upcoming.map((d) => d.customerName.split(" ")[0]).join(", ")}
                  </Text>
                </Pressable>
              )}
              {data.failedRecently > 0 && (
                <Pressable
                  className="flex-row gap-2 py-1.5"
                  onPress={() => router.push("/payouts")}
                >
                  <Icon name="clock" size={18} color="#9fb6d0" />
                  <Text className="flex-1 text-[13px] text-ink">
                    {data.failedRecently} payment{data.failedRecently === 1 ? "" : "s"} retrying —{" "}
                    <Text className="text-faint">Stripe handles it, no action yet</Text>
                  </Text>
                </Pressable>
              )}
              {data.emergencies > 0 && (
                <Pressable className="flex-row gap-2 py-1.5" onPress={() => router.push("/messages")}>
                  <Icon name="warning" size={18} color="#FF6B6B" />
                  <Text className="flex-1 text-[13px] font-semibold text-danger">
                    Gas emergency warning shown to {data.emergencies === 1 ? "a customer" : `${data.emergencies} customers`}{" "}
                    this week — open messages
                  </Text>
                </Pressable>
              )}
              {data.referral && (
                <Pressable
                  className="flex-row gap-2 py-1.5"
                  onPress={() => router.push("/referral")}
                >
                  <Icon name="referral" size={18} color="#9fb6d0" />
                  <Text className="flex-1 text-[13px] text-ink">
                    {data.referral.name} signed up with your invite —{" "}
                    <Text className="font-bold">you&apos;ll earn {data.referral.ratePercent}% of our fee</Text> on
                    every plan they sell
                  </Text>
                </Pressable>
              )}
              {data.upcoming.length === 0 && data.failedRecently === 0 && !data.referral && data.emergencies === 0 && (
                <Text className="py-1 text-xs text-muted">
                  Nothing needs you today — no active plans or messages.
                </Text>
              )}
            </Card>

            <GrowthCard />

            {/* Part 6.5 — the 2×2 quick-action row: My plans · Invite an
                engineer · How it works · Membership Shop. My plans and
                Membership Shop soft-gate; Invite an engineer and How it
                works are "never gated — full brightness always." */}
            <View className="flex-row gap-2.5">
              <QuickAction
                icon="document"
                label="My plans"
                // Any plan, a draft included, opens My plans.
                muted={!awake && !me?.anyTierCount}
                onPress={() => (awake || me?.anyTierCount ? router.push("/plans") : setPlansGateOpen(true))}
              />
              <QuickAction
                icon="invite"
                label="Invite an engineer — earn 25% of our fee"
                onPress={() => router.push("/referral")}
              />
            </View>
            <View className="flex-row gap-2.5">
              <QuickAction
                icon="howItWorks"
                label="How it works"
                onPress={() => router.push("/how-it-works")}
              />
              <QuickAction
                icon="shop"
                label="Membership Shop"
                muted={!verified}
                onPress={() => (verified ? router.push("/membership-shop") : setShopGateOpen(true))}
              />
            </View>
          </>
        )}
      </ScrollView>
      <GateSheet
        visible={plansGateOpen}
        onClose={() => setPlansGateOpen(false)}
        reason="Your first plan is step 2 of setup."
        onCta={() => router.push("/onboarding")}
      />
      <GateSheet
        visible={offerGate !== null}
        onClose={() => setOfferGate(null)}
        reason={offerGate ?? ""}
        cta={lock?.cta ?? "Continue setup"}
        onCta={() => router.push(lock?.href ?? "/onboarding")}
        amber
        demo={awake ? () => router.push("/demo") : undefined}
      />
      <GateSheet
        visible={shopGateOpen}
        onClose={() => setShopGateOpen(false)}
        reason="The shop unlocks with your badge — your free pack ships when it goes live."
        cta="Check my status"
        onCta={() => router.push("/more")}
      />
      <GateSheet
        visible={pushAskOpen}
        onClose={() => {
          setPushAskOpen(false);
          setPushPrompted();
        }}
        reason="Get told when payouts land and services come due"
        cta="Turn on notifications"
        onCta={() => registerForPush(true)}
      />
    </View>
  );
}
