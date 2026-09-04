import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Pill } from "@/components/ui";

type Tag = { label: string; tone: "danger" | "warn" | "info" | "off"; rank: number };
type Ticket = {
  id: string;
  no: number;
  ts: string;
  message: string;
  customerName: string;
  covered: boolean;
  tag: Tag;
};

// Messages & tickets — the engineer's only visibility into customer-reported
// problems, including when the gas-emergency interlock fired. Restored to
// mobile scope 2026-08-03 (see CLAUDE.md) after initially being stubbed as
// P1; the emergency-visibility angle is why it wasn't left as a stub.
export default function Messages() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [recentEmergencies, setRecentEmergencies] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ tickets: Ticket[]; recentEmergencies: number }>("/api/messages");
      setTickets(data.tickets);
      setRecentEmergencies(data.recentEmergencies);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load messages.");
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

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Messages" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {recentEmergencies > 0 && (
          <View className="rounded-[10px] border border-[#E1E8F0] bg-danger-tint px-3 py-2.5">
            <Text className="font-semibold text-xs text-danger">
              ⚠ GAS EMERGENCY WORDING TRIGGERED this week — the customer was shown the emergency
              script and told to call 0800 111 999 before anything else.
            </Text>
          </View>
        )}

        {tickets && tickets.length === 0 && (
          <Card className="items-center py-8">
            <Text className="font-semibold text-sm text-ink">No messages yet</Text>
            <Text className="mt-1.5 text-center font-sans text-xs text-muted">
              Problem reports from your plan customers land here, triaged automatically.
            </Text>
          </Card>
        )}

        {tickets && tickets.length > 0 && (
          <Card>
            {tickets.map((t) => (
              <View key={t.id} className="border-b border-line-soft py-2.5 last:border-b-0">
                <View className="flex-row items-start justify-between gap-2">
                  <View className="shrink">
                    <Text className="font-bold text-sm text-ink">{t.customerName}</Text>
                    <Text className="mt-0.5 font-sans text-xs text-muted">
                      &ldquo;{t.message.slice(0, 90)}
                      {t.message.length > 90 ? "…" : ""}&rdquo;
                    </Text>
                  </View>
                  <Pill tone="info">TICKET #{t.no}</Pill>
                </View>
                <View className="mt-1.5 flex-row gap-1.5">
                  <Pill tone={t.tag.tone}>{t.tag.label}</Pill>
                  {t.covered && <Pill tone="ok">COVERED BY PLAN</Pill>}
                </View>
              </View>
            ))}
          </Card>
        )}

        <Card>
          <Text className="mb-1 font-semibold text-sm text-ink">
            Smart triage on every ticket
          </Text>
          <Text className="font-sans text-xs text-muted">
            Safety events sort to the top and never carry a coverage tag. Other tickets auto-tag
            by type and against the customer&apos;s plan. Replies go by text from your phone for
            now; in-app threads are coming.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}
