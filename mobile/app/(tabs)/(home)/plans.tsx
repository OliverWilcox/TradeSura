import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, Tick, Button } from "@/components/ui";

type Tier = {
  id: string;
  name: string;
  priceMonthlyPence: number;
  status: "DRAFT" | "LIVE" | "STOPPED";
  clauseTitles: string[];
  activePlanCount: number;
};

// Build Guide v2 Part 7 — quick starts, mirroring lib/clauses.ts's
// TIER_PRESETS by hand (display only; the server owns what actually gets
// created — see /api/tiers's `template` handling). CONFIG 19.2: whether
// these show at launch is Matt's call — this constant is the switch.
const SHOW_QUICK_STARTS = true;
const TEMPLATES = [
  { name: "Boiler Care", priceMonthlyPence: 1200 },
  { name: "Boiler + Controls", priceMonthlyPence: 1500 },
  { name: "Landlord Care", priceMonthlyPence: 1500 },
] as const;

const FEE_RATE = 0.2;

const STATUS_PILL: Record<Tier["status"], { tone: "ok" | "off"; label: (n: number) => string }> = {
  LIVE: { tone: "ok", label: (n) => `Live · ${n} customer${n === 1 ? "" : "s"}` },
  STOPPED: { tone: "off", label: (n) => `Stopped · ${n} still on this plan` },
  DRAFT: { tone: "off", label: () => "Draft" },
};

// Build Guide v2 Part 7.3/7.4 — "My plans": the hub page. LAW: zero plans of
// any status means every door (including this one) opens the wizard
// directly — there is no empty hub screen. Once a first plan exists (draft
// or live), this is the room every door lands on, forever after.
export default function PlansHub() {
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Tier[]>("/api/tiers");
      if (data.length === 0) {
        router.replace("/plan-wizard");
        return;
      }
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

  async function startFromTemplate(name: string) {
    setCreating(true);
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/tiers", {
        method: "POST",
        body: JSON.stringify({ template: name }),
      });
      setPickerOpen(false);
      router.push({ pathname: "/plan-wizard", params: { tierId: id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start that plan.");
    } finally {
      setCreating(false);
    }
  }

  function createBlank() {
    setPickerOpen(false);
    router.push("/plan-wizard");
  }

  if (!tiers) {
    return (
      <View className="flex-1 bg-panel">
        <SafeAreaView edges={["top"]} className="bg-iron">
          <AppHeader title="My plans" />
        </SafeAreaView>
        <View className="flex-1 items-center justify-center">
          {error ? (
            <Text className="px-6 text-center font-sans text-sm text-danger">{error}</Text>
          ) : (
            <ActivityIndicator color="#5FA3F0" />
          )}
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="My plans" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text className="font-sans text-sm text-muted">
          Your active plans — ready to offer to your customers.
        </Text>

        <Button onPress={() => (SHOW_QUICK_STARTS ? setPickerOpen((v) => !v) : createBlank())}>
          ＋ Create a new plan
        </Button>

        {pickerOpen && (
          <Card>
            <Micro className="mb-1.5">Start from</Micro>
            <Pressable onPress={createBlank} className="border-b border-line-soft py-2.5">
              <Text className="font-semibold text-sm text-flame-deep">Start blank</Text>
            </Pressable>
            {TEMPLATES.map((t) => (
              <Pressable
                key={t.name}
                onPress={() => startFromTemplate(t.name)}
                disabled={creating}
                className="flex-row items-baseline justify-between border-b border-line-soft py-2.5 last:border-b-0"
              >
                <Text className="font-sans text-sm text-ink">{t.name}</Text>
                <Text className="font-mono text-xs text-muted">
                  £{(t.priceMonthlyPence / 100).toFixed(0)}/mo
                </Text>
              </Pressable>
            ))}
          </Card>
        )}

        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {tiers.map((t) => {
          const fee = Math.round(t.priceMonthlyPence * FEE_RATE);
          const pill = STATUS_PILL[t.status];
          return (
            <Card key={t.id}>
              <View className="flex-row items-baseline justify-between">
                <Text className="font-bold text-base text-ink">{t.name}</Text>
                <Text className="font-mono font-extrabold text-ok">
                  £{(t.priceMonthlyPence / 100).toFixed(0)}
                  <Text className="text-xs font-bold text-muted">/month</Text>
                </Text>
              </View>
              <Text className="mt-0.5 font-mono text-[11px] text-muted">
                You keep £{((t.priceMonthlyPence - fee) / 100).toFixed(2)} a month per customer.
              </Text>
              <View className="mt-2.5 gap-1">
                {t.clauseTitles.map((line) => (
                  <View key={line} className="flex-row items-start gap-2">
                    <Tick size={12} />
                    <Text className="flex-1 text-xs text-ink">{line}</Text>
                  </View>
                ))}
              </View>
              <View className="mt-2.5">
                <Pill tone={pill.tone}>{pill.label(t.activePlanCount)}</Pill>
              </View>
              <View className="mt-3 flex-row gap-2">
                <Button
                  variant="ghost"
                  className="flex-1"
                  onPress={() => router.push({ pathname: "/tier/[tierId]", params: { tierId: t.id } })}
                >
                  Edit plan
                </Button>
                <Button
                  variant="ghost"
                  className="flex-1"
                  onPress={() =>
                    router.push({
                      pathname: "/(tabs)/(customers)/customers",
                      params: { tierId: t.id, planName: t.name },
                    })
                  }
                >
                  View customers
                </Button>
              </View>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}
