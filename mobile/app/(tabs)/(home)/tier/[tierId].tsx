import { useCallback, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, Alert } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, RowLine, Chevron, Button } from "@/components/ui";

// Build Guide v2 Part 7.4 — "Edit plan": three rows, each opening its wizard
// step pre-filled, plus the stop/start toggle. This screen is a menu into
// the wizard (mobile/app/(tabs)/(home)/plan-wizard.tsx), not an editor
// itself — "One builder, every door."
type TierDetail = {
  name: string;
  priceMonthlyPence: number;
  status: "DRAFT" | "LIVE" | "STOPPED";
  clauseIds: string[];
};

const STATUS_PILL: Record<TierDetail["status"], { tone: "ok" | "off"; label: (n: number) => string }> = {
  LIVE: { tone: "ok", label: (n) => `Live · ${n} customer${n === 1 ? "" : "s"}` },
  STOPPED: { tone: "off", label: (n) => `Stopped · ${n} still on this plan` },
  DRAFT: { tone: "off", label: () => "Draft" },
};

export default function EditPlan() {
  const { tierId } = useLocalSearchParams<{ tierId: string }>();
  const [tier, setTier] = useState<TierDetail | null>(null);
  const [activePlanCount, setActivePlanCount] = useState(0);
  const [everHadCustomer, setEverHadCustomer] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{
        tier: TierDetail;
        activePlanCount: number;
        everHadCustomer: boolean;
      }>(`/api/tiers/${tierId}`);
      setTier(data.tier);
      setActivePlanCount(data.activePlanCount);
      setEverHadCustomer(data.everHadCustomer);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load this plan.");
    }
  }, [tierId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openStep(step: 1 | 2 | 3) {
    router.push({ pathname: "/plan-wizard", params: { tierId, editStep: String(step) } });
  }

  async function toggleStatus(action: "stop" | "start") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/tiers/${tierId}/status`, { method: "POST", body: JSON.stringify({ action }) });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update this plan.");
    } finally {
      setBusy(false);
    }
  }

  function confirmStop() {
    Alert.alert(
      "Stop offering this plan?",
      "Customers already on it keep their plan, untouched. You can start offering it again any time.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Stop offering", style: "destructive", onPress: () => toggleStatus("stop") },
      ],
    );
  }

  async function deleteDraft() {
    Alert.alert("Delete this draft?", "It's never been offered — this can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await api(`/api/tiers/${tierId}`, { method: "DELETE" });
            router.replace("/(tabs)/(home)/plans");
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Couldn't delete this draft.");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (loadError) {
    return (
      <View className="flex-1 bg-panel">
        <SafeAreaView edges={["top"]} className="bg-iron">
          <AppHeader title="Edit plan" />
        </SafeAreaView>
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="font-sans text-sm text-danger">{loadError}</Text>
          <Button onPress={load} variant="ghost" className="w-full">
            Try again
          </Button>
        </View>
      </View>
    );
  }

  if (!tier) {
    return (
      <View className="flex-1 bg-panel">
        <SafeAreaView edges={["top"]} className="bg-iron">
          <AppHeader title="Edit plan" />
        </SafeAreaView>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#5FA3F0" />
        </View>
      </View>
    );
  }

  const pill = STATUS_PILL[tier.status];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title={tier.name} />
      </SafeAreaView>
      <View className="gap-2.5 px-4 pb-8 pt-4">
        <Pill tone={pill.tone}>{pill.label(activePlanCount)}</Pill>

        {activePlanCount > 0 && (
          <Card className="border-warn-tint bg-warn-tint">
            <Text className="font-sans text-xs text-warn">
              Changes apply to new customers — your {activePlanCount} current customer
              {activePlanCount === 1 ? "" : "s"} keep what they signed up for.
            </Text>
          </Card>
        )}

        <Card>
          <Pressable onPress={() => openStep(1)}>
            <RowLine left="What's included" right={<Chevron />} />
          </Pressable>
          <Pressable onPress={() => openStep(2)}>
            <RowLine
              left="Price"
              right={
                <View className="flex-row items-center gap-1.5">
                  <Text className="font-mono text-sm text-ok">
                    £{(tier.priceMonthlyPence / 100).toFixed(0)}/mo
                  </Text>
                  <Chevron />
                </View>
              }
            />
          </Pressable>
          <Pressable onPress={() => openStep(3)}>
            <RowLine left="Name" right={<Chevron />} />
          </Pressable>
        </Card>

        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {tier.status === "LIVE" && (
          <Pressable onPress={confirmStop} disabled={busy} className="items-center py-2.5">
            <Text className="font-sans text-sm text-muted">Stop offering this plan</Text>
          </Pressable>
        )}
        {tier.status === "STOPPED" && (
          <Button variant="ghost" onPress={() => toggleStatus("start")} disabled={busy}>
            Start offering again
          </Button>
        )}
        {tier.status === "DRAFT" && !everHadCustomer && (
          <Pressable onPress={deleteDraft} disabled={busy} className="items-center py-2.5">
            <Text className="font-sans text-sm text-danger">Delete this draft</Text>
          </Pressable>
        )}
        <Micro className="text-center">
          A plan that&apos;s ever had a customer can be stopped, never deleted.
        </Micro>
      </View>
    </View>
  );
}
