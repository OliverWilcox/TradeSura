import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button, GateSheet } from "@/components/ui";
import { Icon } from "@/components/icon";
import { RingProgress, payoutWeekProgress } from "@/components/ring-progress";

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
  referral: { name: string; required: number } | null;
  offersWaiting: { customerFirstName: string; planId: string } | null;
  standing: Standing;
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
    <Pressable onPress={() => router.push("/more")} className={`flex-row items-center gap-2 rounded-xl border px-3 py-2 ${toneCls}`}>
      {standing.tone === "quiet" && <Icon name="verified" size={14} color="#3dd68c" />}
      {standing.tone === "amber" && <Icon name="pending" size={14} color="#f2b84b" />}
      {standing.tone === "red" && <Icon name="warning" size={14} color="#ff6b6b" />}
      <Text className={`flex-1 font-sans text-xs ${textCls}`} numberOfLines={2}>
        {standing.text}
      </Text>
    </Pressable>
  );
}

// Screen 02 — the money mirror. Part 6.1 LAW: header → greeting → standing
// strip → money card → action card → Today → quick actions. Nothing may
// appear above the money card except the header, greeting and the strip.
export default function Home() {
  const { me } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [plansGateOpen, setPlansGateOpen] = useState(false);
  const [shopGateOpen, setShopGateOpen] = useState(false);

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const awake = Boolean(me?.hasPlan);
  const verified = Boolean(me?.gasSafeVerifiedAt);

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
          {me?.firstName ? `Hello, ${me.firstName}` : "Hello"}
        </Text>
        <Text className="-mt-2 text-sm text-muted">
          {awake
            ? "Offer a plan at the end of the job — most take under 90 seconds."
            : "Once you're set up, offering a plan takes under 90 seconds."}
        </Text>

        {data && <StandingStrip standing={data.standing} />}

        {loading && !data && !error && (
          <View className="items-center py-10">
            <ActivityIndicator color="#5FA3F0" />
          </View>
        )}

        {error && <Text className="text-sm text-danger">{error}</Text>}
        {data && (
          <>
            {/* Part 6.2/6.3 LAW — one hero number, nothing else on this card;
                the ring is dormant until the first live plan, then it wakes
                and draws in the payout week's progress. */}
            <Card variant="hero">
              <View className="flex-row items-center gap-3">
                <RingProgress size={44} progress={payoutWeekProgress()} dormant={!awake} />
                <View className="flex-1">
                  <Micro>Your plan income</Micro>
                  <Text className="mt-0.5 text-[32px] font-extrabold leading-none text-copper">
                    £{(data.totalPence / 100).toFixed(0)}
                    <Text className="text-base font-bold text-muted"> /month</Text>
                  </Text>
                </View>
              </View>
              <Text className="mt-2 text-[12.5px] text-muted">
                {data.count === 0
                  ? "Your first plan changes this"
                  : `${data.count} plan${data.count === 1 ? "" : "s"} live · ${data.offersOut} offer${data.offersOut === 1 ? "" : "s"} out`}
              </Text>
              <View className="mt-2.5 flex-row items-center justify-between border-t border-line-strong pt-2.5">
                <Text className="text-[12.5px] text-muted">
                  {awake && data.nextPayoutPence !== null ? "Next payout" : "Paid every"}
                </Text>
                {awake && data.nextPayoutPence !== null ? (
                  <Text className="font-mono font-bold text-copper">
                    £{(data.nextPayoutPence / 100).toFixed(2)}
                    {data.nextPayoutDate
                      ? ` · ${new Date(data.nextPayoutDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
                      : ""}
                  </Text>
                ) : (
                  <Text className="font-mono font-bold text-muted">Friday</Text>
                )}
              </View>
            </Card>

            {data.count === 0 && (
              <Card>
                <Micro>Get started</Micro>
                <Text className="mt-1 text-[15px] font-bold text-ink">Send your first offer</Text>
                <Text className="mt-1 text-[12.5px] text-muted">
                  One customer on a plan and this card becomes your income.
                </Text>
                <Button className="mt-3" onPress={() => router.push("/offer")}>
                  Offer a plan
                </Button>
              </Card>
            )}

            {data.noPlan >= 5 && (
              <Card className="border-[rgba(242,184,75,.3)] bg-warn-tint">
                <View className="flex-row items-center justify-between">
                  <View className="shrink">
                    <Text className="font-mono font-bold text-warn">
                      £{(data.prizeYearlyPence / 100).toFixed(0)}/yr not collected
                    </Text>
                    <Text className="mt-0.5 text-[12.5px] text-muted">
                      {data.noPlan} book customers aren&apos;t on a plan yet
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
                  {data.offersWaiting.customerFirstName} hasn&apos;t set up their plan yet
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
              {data.referral && (
                <Pressable
                  className="flex-row gap-2 py-1.5"
                  onPress={() => router.push("/referral")}
                >
                  <Icon name="referral" size={18} color="#9fb6d0" />
                  <Text className="flex-1 text-[13px] text-ink">
                    {data.referral.name} signed up with your invite —{" "}
                    <Text className="font-bold">you&apos;ll get £50</Text> when their first plan
                    goes live
                  </Text>
                </Pressable>
              )}
              {data.upcoming.length === 0 && data.failedRecently === 0 && !data.referral && (
                <Text className="py-1 text-xs text-muted">
                  Nothing needs you today — no active plans or messages.
                </Text>
              )}
            </Card>

            {/* Part 6.5 — the 2×2 quick-action row: My plans · Invite an
                engineer · How it works · Membership Shop. My plans and
                Membership Shop soft-gate; Invite an engineer and How it
                works are "never gated — full brightness always." */}
            <View className="flex-row gap-2.5">
              <Button
                variant="ghost"
                className={`flex-1 ${awake ? "" : "opacity-40"}`}
                onPress={() => (awake ? router.push("/plans") : setPlansGateOpen(true))}
              >
                My plans
              </Button>
              <Button variant="ghost" className="flex-1" onPress={() => router.push("/referral")}>
                Invite an engineer
              </Button>
            </View>
            <View className="flex-row gap-2.5">
              <Button variant="ghost" className="flex-1" onPress={() => router.push("/how-it-works")}>
                How it works
              </Button>
              <Button
                variant="ghost"
                className={`flex-1 ${verified ? "" : "opacity-40"}`}
                onPress={() => (verified ? router.push("/membership-shop") : setShopGateOpen(true))}
              >
                Membership Shop
              </Button>
            </View>
            <Button variant="ghost" onPress={() => router.push("/demo")}>
              Show a customer
            </Button>
          </>
        )}
      </ScrollView>
      <GateSheet
        visible={plansGateOpen}
        onClose={() => setPlansGateOpen(false)}
        reason="Your first plan is step 2 of setup — Continue setup →"
        onCta={() => router.push("/onboarding")}
      />
      <GateSheet
        visible={shopGateOpen}
        onClose={() => setShopGateOpen(false)}
        reason="The shop unlocks with your badge — your free pack ships when it goes live."
        cta="Check my status"
        onCta={() => router.push("/more")}
      />
    </View>
  );
}
