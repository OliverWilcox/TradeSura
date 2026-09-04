import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Money, Pill, Button } from "@/components/ui";

type Tier = {
  id: string;
  name: string;
  priceMonthlyPence: number;
  isRecommended: boolean;
  customLabels: string[];
  clauseTitles: string[];
  planCount: number;
};

// E6 starting templates — mirrors lib/clauses.ts's TIER_PRESETS. Duplicated
// display data (name/price/blurb) only; the server is the source of truth
// for what actually gets created.
const TEMPLATES = [
  {
    name: "Boiler Care",
    priceMonthlyPence: 1200,
    blurb: "Annual service · priority call-outs",
    recommended: false,
  },
  {
    name: "Boiler + Controls",
    priceMonthlyPence: 1500,
    blurb: "Everything in Boiler Care + smart thermostat + health check",
    recommended: true,
  },
  {
    name: "Landlord Care",
    priceMonthlyPence: 1500,
    blurb: "Everything in Boiler Care + CP12 + landlord cert storage",
    recommended: false,
  },
] as const;

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

  // E6 — pick one template, land straight in its editor to price it, toggle
  // inclusions, and make it live.
  async function chooseTemplate(name: string) {
    setCreating(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/tiers", {
        method: "POST",
        body: JSON.stringify({ template: name }),
      });
      router.push({ pathname: "/tier/[tierId]", params: { tierId: id, fresh: "1" } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the tier.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Plan builder" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {tiers?.length === 0 && (
          <>
            <Card className="border-flame-tint bg-flame-tint">
              <Text className="font-sans text-xs text-flame">
                <Text className="font-semibold">Legal wording locked in.</Text> Your plan uses
                solicitor-approved maintenance-and-priority terms. Breakdown-repair promises are
                insurance — TradeSura keeps you on the right side of the line automatically.
              </Text>
            </Card>

            <Text className="mt-1 font-sans text-sm text-ink">Pick a starting point</Text>
            {TEMPLATES.map((t) => (
              <Card key={t.name} className={t.recommended ? "border-copper" : undefined}>
                <View className="flex-row items-baseline justify-between">
                  <Text className="font-semibold text-base text-ink">{t.name}</Text>
                  <Money pence={t.priceMonthlyPence} suffix="/mo" />
                </View>
                <Text className="mt-1 font-sans text-xs text-muted">{t.blurb}</Text>
                <View className="mt-2 flex-row items-center justify-between">
                  {t.recommended ? <Pill tone="ok">MOST POPULAR</Pill> : <View />}
                  <Button
                    variant="ghost"
                    className="px-4 py-2"
                    onPress={() => chooseTemplate(t.name)}
                    disabled={creating}
                  >
                    Choose
                  </Button>
                </View>
              </Card>
            ))}

            <Button variant="ghost" onPress={() => createTiers(true)} disabled={creating}>
              {creating ? "Creating…" : "Or start with all 3 recommended tiers"}
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
                  <Text className="font-semibold text-lg uppercase tracking-wide text-ink">
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
