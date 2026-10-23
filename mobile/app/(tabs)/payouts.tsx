import { useCallback, useEffect, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, Share } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, apiText, ApiError, getHasSeenFirstPayout, setHasSeenFirstPayout } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, RowLine, Button } from "@/components/ui";
import { RingProgress, payoutWeekProgress } from "@/components/ring-progress";
import { Skeleton, Bone, TextBone, RowBone } from "@/components/skeleton";

type FailedPlan = { id: string; customerName: string; priceMonthlyPence: number };
type StripeSummary = {
  pendingPence: number;
  availablePence: number;
  nextPayout: { amountPence: number; arrivalDate: string; status: string } | null;
  history: { id: string; amountPence: number; arrivalDate: string; status: string }[];
};
type Standing = { state: string; tone: "amber" | "red" | "quiet"; text: string };
// Real cleared collections and the exact per-collection deductions
// (app/api/payouts → lib/plans.ts collectionsSince).
type Collections = {
  count: number;
  collectedPence: number;
  feePence: number;
  toBankPence: number;
};
type PayoutsData = {
  totalPence: number;
  count: number;
  fee: number;
  month: Collections;
  week: Collections;
  referralBonusPence: number;
  bankLast4: string | null;
  stripe: StripeSummary | null;
  stripeError: boolean;
  accountRestricted: boolean;
  standing: Standing;
  payments: Standing;
  failedPlans: FailedPlan[];
};

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Europe/London" });
}

// E11 — Payouts & collections. Real Stripe balance + payout history once the
// account is live; the plan maths until then.
// Hero (ring + payout figure), the month breakdown and the recovery card.
function PayoutsSkeleton() {
  return (
    <Skeleton label="Loading your payouts" className="gap-3.5">
      <Card variant="hero">
        <View className="flex-row items-center gap-3">
          <Bone width={44} height={44} radius={22} />
          <View className="flex-1">
            <TextBone width={150} size={11} />
            <View className="mt-0.5 h-9 justify-center">
              <Bone width={130} height={28} radius={6} />
            </View>
          </View>
        </View>
        <TextBone width="85%" size={12} style={{ marginTop: 8 }} />
      </Card>
      <Card>
        <TextBone width={170} size={11} style={{ marginBottom: 6 }} />
        <RowBone left={180} />
        <RowBone left={150} right={50} />
        <RowBone left={100} right={70} last />
      </Card>
      <Card>
        <TextBone width={190} size={14} style={{ marginBottom: 4 }} />
        <TextBone width="75%" size={12} style={{ marginVertical: 4 }} />
      </Card>
    </Skeleton>
  );
}

export default function Payouts() {
  const [data, setData] = useState<PayoutsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<PayoutsData>("/api/payouts"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load payouts.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // E11b — the first time this account has exactly one real Stripe payout,
  // show the celebration once, ever, then never again.
  useEffect(() => {
    const history = data?.stripe?.history;
    if (!history || history.length !== 1) return;
    getHasSeenFirstPayout().then((seen) => {
      if (seen || !data) return;
      setHasSeenFirstPayout();
      router.push({
        pathname: "/first-payout",
        params: {
          amountPence: String(history[0].amountPence),
          plans: String(data.count),
          monthlyPence: String(data.totalPence - data.fee),
          ...(data.bankLast4 ? { bankLast4: data.bankLast4 } : {}),
        },
      });
    });
  }, [data]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await apiText("/api/payouts/export");
      await Share.share({ message: csv, title: "TradeSura plans export" });
    } catch (e) {
      setExportError(e instanceof ApiError ? e.message : "Couldn't export.");
    } finally {
      setExporting(false);
    }
  }

  const s = data?.stripe;
  // Part 6.3 LAW — before Stripe reports a payout, NEXT PAYOUT is this
  // week's cleared collections, never the monthly total × 80%.
  const weekToBank = data ? data.week.toBankPence : 0;

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text className="text-[28px] font-extrabold tracking-tight text-ink">Payouts</Text>
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {/* Part 12 LAW — "an amber slim banner... reads the standing strip's
            truth source. Red stays reserved for genuinely broken." Banned/
            paused (genuinely broken) still gets red; Stripe mid-onboarding
            is amber, not red. */}
        {data && (data.standing.state === "BANNED" || data.standing.state === "PAUSED") && (
          <Card className="border-danger-tint bg-danger-tint">
            <Text className="font-semibold text-sm text-danger">{data.standing.text}</Text>
          </Card>
        )}
        {data && data.payments.tone === "amber" && data.standing.state !== "BANNED" && data.standing.state !== "PAUSED" && (
          <Pressable onPress={() => router.push("/more")}>
            <Card className="border-warn-tint bg-warn-tint">
              <Text className="font-semibold text-sm text-warn">{data.payments.text}</Text>
            </Card>
          </Pressable>
        )}

        {!data && !error && <PayoutsSkeleton />}

        {data && (
          <>
            {/* E11 / Part 12 — "NEXT PAYOUT hero with the ring docked,"
                drawing in the payout week's progress (see
                components/ring-progress.tsx for the LAW exception this is
                built under). */}
            <Card variant="hero">
              <View className="flex-row items-center gap-3">
                <RingProgress size={44} progress={payoutWeekProgress()} dormant={data.count === 0} />
                <View className="flex-1">
                  <Micro>
                    {s?.nextPayout ? `Next payout · ${shortDate(s.nextPayout.arrivalDate)}` : "Next payout · Friday"}
                  </Micro>
                  <Text className="mt-0.5 font-mono font-semibold text-3xl text-copper">
                    {pounds(s?.nextPayout ? s.nextPayout.amountPence : weekToBank)}
                  </Text>
                </View>
              </View>
              <Text className="mt-2 font-sans text-xs text-night-muted">
                {/* Part 12 — "before anything's live" means before any PLAN
                    is live, independent of Stripe connection status. An
                    engineer can have Stripe connected with zero plans (this
                    is the common early-onboarding order — payments first,
                    plan second per Part 5), and the guide's empty-state
                    line must still win in that case, not the live Stripe
                    balance (found live-testing a real account in exactly
                    this state — the balance line used to take priority over
                    `data.count === 0` here). */}
                {data.count === 0
                  ? "Payouts start when your first plan goes live — paid every Friday."
                  : "This week's cleared collections — your 80%, paid direct to your bank."}
              </Text>
              {s && data.count > 0 && (
                <Text className="mt-1 font-sans text-[11px] text-night-muted">
                  <Text className="font-mono">{pounds(s.availablePence)}</Text> available ·{" "}
                  <Text className="font-mono">{pounds(s.pendingPence)}</Text> still clearing
                </Text>
              )}
              {data.stripeError && (
                <Text className="mt-1 font-sans text-[11px] text-warn">
                  Couldn&apos;t reach Stripe just now — showing the plan maths instead.
                </Text>
              )}
            </Card>

            <Card>
              <Micro className="mb-1.5">This month, transparently</Micro>
              <RowLine
                left={`${data.month.count} collection${data.month.count === 1 ? "" : "s"} cleared`}
                right={<Text className="font-mono text-sm text-ink">{pounds(data.month.collectedPence)}</Text>}
              />
              <RowLine
                left="TradeSura fee (20%)"
                right={
                  <Text className="font-mono text-ink">
                    {data.month.feePence > 0 ? "−" : ""}
                    {pounds(data.month.feePence)}
                  </Text>
                }
              />
              {data.referralBonusPence > 0 && (
                <RowLine
                  left="Referral bonus"
                  right={
                    <Text className="font-mono font-semibold text-ok">
                      ＋{pounds(data.referralBonusPence)}
                    </Text>
                  }
                />
              )}
              <RowLine
                left={<Text className="font-bold text-sm text-ink">To your bank</Text>}
                right={
                  <Text className="font-mono font-semibold text-copper">
                    {pounds(data.month.toBankPence + data.referralBonusPence)}
                  </Text>
                }
              />
              {data.bankLast4 && (
                <RowLine left="Bank" right={<Text className="font-mono">···{data.bankLast4}</Text>} />
              )}
            </Card>

            {s && s.history.length > 0 && (
              <Card>
                <Micro className="mb-1.5">Payout history</Micro>
                {s.history.map((h) => (
                  <RowLine
                    key={h.id}
                    left={shortDate(h.arrivalDate)}
                    right={
                      <Text className="font-mono font-semibold text-copper">{pounds(h.amountPence)}</Text>
                    }
                  />
                ))}
              </Card>
            )}

            <Card>
              <Text className="mb-1 font-semibold text-sm text-ink">
                Failed collection recovery
              </Text>
              {data.failedPlans.length === 0 ? (
                <Text className="py-1 font-sans text-xs text-muted">
                  No failed collections in the last 30 days.
                </Text>
              ) : (
                data.failedPlans.map((p) => (
                  <View
                    key={p.id}
                    className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
                  >
                    <View className="shrink">
                      <Text className="font-bold text-sm text-ink">
                        {p.customerName} · <Text className="font-mono">{pounds(p.priceMonthlyPence)}</Text>
                      </Text>
                      <Micro>STRIPE RETRIES AUTOMATICALLY</Micro>
                    </View>
                    <Pill tone="warn">AUTO</Pill>
                  </View>
                ))
              )}
              <Text className="mt-1.5 font-sans text-xs text-muted">
                Smart retries run automatically; most failures recover themselves.
              </Text>
            </Card>

            <Card>
              {exportError && (
                <Text className="mb-2 font-sans text-xs text-danger">{exportError}</Text>
              )}
              <Button variant="ghost" onPress={exportCsv} disabled={exporting}>
                {exporting ? "Preparing…" : "Tax-year export (CSV)"}
              </Button>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
