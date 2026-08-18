import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Money, Pill, Button } from "@/components/ui";

type Tier = {
  id: string;
  name: string;
  priceMonthlyPence: number;
  isRecommended: boolean;
  customLabels: string[];
  clauseTitles: string[];
  planCount: number;
};

// Screen 03 — plan builder (list).
export default function Plans() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Tier[]>("/api/tiers");
      setTiers(data);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your plans.");
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

  async function createTiers(preset: boolean) {
    setCreating(true);
    try {
      await api("/api/tiers", { method: "POST", body: JSON.stringify({ preset }) });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the tier.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader right={<Micro className="text-[#AEB9C4]">Plan builder</Micro>} />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {tiers?.length === 0 && (
          <>
            <Card className="border-[#BBDCF4] bg-flame-tint">
              <Text className="font-sans text-xs text-flame-deep">
                <Text className="font-sans-semibold">Legal wording locked in.</Text> Your plan uses
                solicitor-approved maintenance-and-priority terms. Breakdown-repair promises are
                insurance — TradeSura keeps you on the right side of the line automatically.
              </Text>
            </Card>
            <Button onPress={() => createTiers(true)} disabled={creating}>
              {creating
                ? "Creating…"
                : "Start with the 3 recommended tiers — Essential £9 / Plus £15 / Complete £22"}
            </Button>
          </>
        )}

        {tiers && tiers.length > 0 && (
          <>
            {tiers.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => router.push(`/tier/${t.id}`)}
                className={`rounded-xl border bg-paper p-4 ${t.isRecommended ? "border-copper" : "border-line"}`}
              >
                <View className="flex-row items-baseline justify-between">
                  <Text className="font-disp text-lg uppercase tracking-wide text-ink">
                    {t.name}
                  </Text>
                  <Money pence={t.priceMonthlyPence} suffix="/mo" />
                </View>
                <Text className="mt-1 font-sans text-xs text-muted">
                  {[...t.clauseTitles, ...t.customLabels].join(" · ")}
                </Text>
                <View className="mt-2 flex-row gap-1.5">
                  {t.isRecommended && <Pill tone="info">MOST CHOSEN</Pill>}
                  <Pill tone={t.planCount > 0 ? "ok" : "off"}>{t.planCount} ON THIS TIER</Pill>
                </View>
              </Pressable>
            ))}
            {tiers.length < 3 && (
              <Button variant="ghost" onPress={() => createTiers(false)} disabled={creating}>
                {creating ? "Creating…" : "＋ New plan"}
              </Button>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
