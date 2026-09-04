import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Share } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, apiText, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, RowLine, Button } from "@/components/ui";

type FailedPlan = { id: string; customerName: string; priceMonthlyPence: number };
type StripeSummary = {
  pendingPence: number;
  availablePence: number;
  nextPayout: { amountPence: number; arrivalDate: string; status: string } | null;
  history: { id: string; amountPence: number; arrivalDate: string; status: string }[];
};
type PayoutsData = {
  totalPence: number;
  count: number;
  fee: number;
  confirmed: number;
  referralBonusPence: number;
  processingPence: number;
  bankLast4: string | null;
  stripe: StripeSummary | null;
  stripeError: boolean;
  accountRestricted: boolean;
  failedPlans: FailedPlan[];
};

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

// E11 — Payouts & collections. Real Stripe balance + payout history once the
// account is live; the plan maths until then.
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
  const expectedToBank = data ? data.totalPence - data.fee : 0;

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Payouts" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {data?.accountRestricted && (
          <Card className="border-danger-tint bg-danger-tint">
            <Text className="font-semibold text-sm text-danger">
              Stripe needs more information
            </Text>
            <Text className="mt-1 font-sans text-xs text-danger">
              Your payouts are on hold until you finish verifying your account. Open the payment
              setup from More → Payments to complete it.
            </Text>
          </Card>
        )}

        {data && (
          <>
            <Card>
              <Micro className="mb-1">
                {s?.nextPayout ? `Next payout · ${shortDate(s.nextPayout.arrivalDate)}` : "Expected monthly payout"}
              </Micro>
              <Text className="font-mono font-semibold text-3xl text-copper">
                {pounds(s?.nextPayout ? s.nextPayout.amountPence : expectedToBank)}
              </Text>
              <Text className="mt-1 font-sans text-xs text-muted">
                {s
                  ? `${pounds(s.availablePence)} available · ${pounds(s.pendingPence)} still clearing`
                  : `${data.count} active plan${data.count === 1 ? "" : "s"} · paid out direct to your bank`}
              </Text>
              {!s && !data.stripeError && (
                <Text className="mt-1 font-sans text-[11px] text-faint">
                  The live Stripe payout feed switches on once your first collections clear; until
                  then this is the maths of your active plans.
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
                left={`${data.confirmed} collection${data.confirmed === 1 ? "" : "s"} · your 80%`}
                right={pounds(data.totalPence - data.fee)}
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
                left={`Processing (${data.confirmed} × ~32p)`}
                right={
                  <Text className="font-mono text-danger">−{pounds(data.processingPence)}</Text>
                }
              />
              <RowLine
                left={<Text className="font-bold text-sm text-ink">To your bank</Text>}
                right={
                  <Text className="font-mono font-semibold text-copper">
                    {pounds(
                      data.totalPence - data.fee + data.referralBonusPence - data.processingPence,
                    )}
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
                      <Text className="font-mono font-semibold text-copper">{pounds(h.amountPence)} ✓</Text>
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
                        {p.customerName} · {pounds(p.priceMonthlyPence)}
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
