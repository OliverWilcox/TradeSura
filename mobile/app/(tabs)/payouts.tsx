import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Share } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, apiText, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, RowLine, Button } from "@/components/ui";

type FailedPlan = { id: string; customerName: string; priceMonthlyPence: number };
type PayoutsData = {
  totalPence: number;
  count: number;
  fee: number;
  confirmed: number;
  failedPlans: FailedPlan[];
};

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

// Payouts & collections (full screen) — restored to mobile scope 2026-08-03
// (see CLAUDE.md). The More hub's inline card is just the summary line item;
// this is the fuller breakdown.
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

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader right={<Micro className="text-[#AEB9C4]">Payouts</Micro>} />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {data && (
          <>
            <Card>
              <Text className="mb-1 font-sans-semibold text-sm text-ink">
                Expected monthly payout
              </Text>
              <Text className="font-mono-semibold text-3xl text-copper">
                {pounds(data.totalPence - data.fee)}
              </Text>
              <Text className="mt-1 font-sans text-xs text-muted">
                {data.count} active plan{data.count === 1 ? "" : "s"} · paid out direct to your
                bank
              </Text>
              <Text className="mt-1 font-sans text-[11px] text-faint">
                The live payout feed switches on once the payment provider is connected; until
                then this is the maths of your active plans.
              </Text>
            </Card>

            <Card>
              <Micro className="mb-1.5">This month, transparently</Micro>
              <RowLine left="Plan collections (expected)" right={pounds(data.totalPence)} />
              <RowLine left="TradeSura fee (20%)" right={`−${pounds(data.fee)}`} />
              <RowLine left="Collections confirmed" right={String(data.confirmed)} />
              <RowLine
                left={
                  <Text className="font-sans-bold text-sm text-ink">
                    To your bank (before DD costs)
                  </Text>
                }
                right={
                  <Text className="font-mono-semibold text-copper">
                    {pounds(data.totalPence - data.fee)}
                  </Text>
                }
              />
            </Card>

            <Card>
              <Text className="mb-1 font-sans-semibold text-sm text-ink">
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
                      <Text className="font-sans-bold text-sm text-ink">
                        {p.customerName} · {pounds(p.priceMonthlyPence)}
                      </Text>
                      <Micro>GOCARDLESS RETRIES AUTOMATICALLY</Micro>
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
