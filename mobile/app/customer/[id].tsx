import { useCallback, useState } from "react";
import { View, Text, ScrollView, Alert, ActivityIndicator, Linking } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, RowLine, Button } from "@/components/ui";

type Detail = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  source: string;
  address: string | null;
  appliance: { label: string; lastServicedAt: string | null } | null;
  plan: {
    id: string;
    tierName: string;
    priceMonthlyPence: number;
    status: string;
    mandateStatus: string | null;
    activatedAt: string | null;
    portalToken: string;
  } | null;
  timeline: { at: string; icon: string; text: string }[];
};

const SOURCE_LABEL: Record<string, string> = {
  added: "added manually",
  doorstep: "doorstep signup",
  web: "plan signup",
  import: "imported",
  contacts: "phone contacts",
};

function d(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setC(await api<Detail>(`/api/customers/${id}`));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this customer.");
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function recordService() {
    setBusy(true);
    try {
      await api(`/api/customers/${id}/service`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (e) {
      Alert.alert("Couldn't record", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirmPause() {
    Alert.alert(
      "Pause this plan?",
      "Collections stop and the customer is messaged nothing until you resume. Their plan history is kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Pause plan",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await api(`/api/customers/${id}/pause`, { method: "POST" });
              await load();
            } catch (e) {
              Alert.alert("Couldn't pause", e instanceof ApiError ? e.message : "Try again.");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  function confirmRemove() {
    Alert.alert("Remove this customer?", "This deletes their record and any offer history.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await api(`/api/customers/${id}`, { method: "DELETE" });
            router.back();
          } catch (e) {
            Alert.alert("Couldn't remove", e instanceof ApiError ? e.message : "Try again.");
            setBusy(false);
          }
        },
      },
    ]);
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
        <Text className="font-sans text-sm text-danger">{error}</Text>
        <Button onPress={load} variant="ghost" className="w-full">
          Try again
        </Button>
      </View>
    );
  }
  if (!c) {
    return (
      <View className="flex-1 items-center justify-center bg-panel">
        <ActivityIndicator color="#5FA3F0" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Customer" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        <View className="flex-row items-start justify-between gap-2">
          <View className="shrink">
            <Text className="font-bold text-xl uppercase tracking-wide text-ink">
              {c.firstName} {c.lastName}
            </Text>
            <Text className="font-sans text-xs text-muted">
              {c.phone}
              {c.address ? ` · ${c.address}` : ""} · {SOURCE_LABEL[c.source] ?? c.source}
            </Text>
          </View>
          {c.plan ? <Pill tone="ok">ON PLAN</Pill> : <Pill tone="off">NO PLAN</Pill>}
        </View>

        {c.plan ? (
          <Card>
            <RowLine
              left={<Text className="font-bold text-sm text-ink">{c.plan.tierName} · £{(c.plan.priceMonthlyPence / 100).toFixed(0)}/mo</Text>}
              right={
                <Text className="font-mono text-[11px] text-muted">
                  {c.plan.activatedAt ? `since ${d(c.plan.activatedAt)}` : ""}
                </Text>
              }
            />
            <RowLine
              left="Direct Debit"
              right={
                <Text
                  className={`font-semibold text-sm ${c.plan.status === "PAUSED" ? "text-warn" : "text-ok"}`}
                >
                  {c.plan.status === "PAUSED" ? "Paused" : c.plan.mandateStatus === "pending" ? "Setting up" : "Active"}
                </Text>
              }
            />
            {c.appliance?.lastServicedAt && (
              <RowLine left="Last service" right={d(c.appliance.lastServicedAt)} />
            )}
          </Card>
        ) : (
          <Button
            onPress={() => router.push({ pathname: "/offer", params: { customerId: c.id } })}
          >
            Offer a plan
          </Button>
        )}

        <Card>
          <Micro className="mb-1.5">Timeline</Micro>
          {c.timeline.length === 0 ? (
            <Text className="py-1 font-sans text-xs text-muted">Nothing recorded yet.</Text>
          ) : (
            c.timeline.map((t, i) => (
              <View key={i} className="flex-row items-center gap-2 py-1.5">
                <Text>{t.icon}</Text>
                <Text className="flex-1 font-sans text-[13px] text-ink">{t.text}</Text>
                <Text className="font-mono text-[10px] text-faint">{d(t.at)}</Text>
              </View>
            ))
          )}
        </Card>

        <View className="flex-row gap-2">
          <Button variant="ghost" className="flex-1" onPress={recordService} disabled={busy}>
            Record a service
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            onPress={() => Linking.openURL(`sms:${c.phone}`)}
          >
            Message
          </Button>
        </View>

        {c.plan?.status === "ACTIVE" && (
          <Button variant="dangerghost" onPress={confirmPause} disabled={busy}>
            Pause plan
          </Button>
        )}
        {!c.plan && (
          <Button variant="dangerghost" onPress={confirmRemove} disabled={busy}>
            Remove customer
          </Button>
        )}
      </ScrollView>
    </View>
  );
}
