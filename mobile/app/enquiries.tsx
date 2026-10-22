import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, Linking } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Pill, ScreenTitle } from "@/components/ui";
import { Icon } from "@/components/icon";
import { Skeleton, ListRowBone } from "@/components/skeleton";

type Enquiry = {
  id: string;
  kind: "call" | "message";
  name: string | null;
  phone: string | null;
  email: string | null;
  message: string | null;
  source: string | null;
  createdAt: string;
};
type Data = { thisMonth: { total: number; calls: number; messages: number }; items: Enquiry[] };

const SOURCE: Record<string, string> = { profile: "Profile", town: "Town page", widget: "Website" };

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Section 6 — enquiries from the public profile: messages to reply to by
// call or text, and call taps (the visitor's number isn't known for those).
export default function Enquiries() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/enquiries"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load enquiries.");
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

  const messages = data?.items.filter((q) => q.kind === "message") ?? [];
  const calls = data?.items.filter((q) => q.kind === "call") ?? [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Enquiries" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScreenTitle
          title="Enquiries"
          intro={
            data
              ? `TradeSura sent you ${data.thisMonth.total} this month: ${data.thisMonth.messages} message${data.thisMonth.messages === 1 ? "" : "s"} and ${data.thisMonth.calls} call${data.thisMonth.calls === 1 ? "" : "s"}.`
              : "Messages and calls from your TradeSura profile."
          }
        />
        {error && <Text className="text-sm text-danger">{error}</Text>}
        {!data && !error && (
          <Skeleton label="Loading enquiries">
            <Card>
              <ListRowBone title={120} subtitle="90%" pill={60} />
              <ListRowBone title={100} subtitle="80%" pill={60} />
            </Card>
          </Skeleton>
        )}

        {data && messages.length === 0 && calls.length === 0 && (
          <Card>
            <Text className="text-[14px] text-muted">
              No enquiries yet. Publish your profile and switch on Call and Message to start getting them.
            </Text>
          </Card>
        )}

        {messages.map((q) => (
          <Card key={q.id}>
            <View className="flex-row items-start justify-between gap-2">
              <View className="shrink">
                <Text className="text-[15px] font-bold text-ink">{q.name || "Someone"}</Text>
                <Text className="text-[12px] text-muted">
                  {when(q.createdAt)}
                  {q.source ? ` · ${SOURCE[q.source] ?? q.source}` : ""}
                </Text>
              </View>
              <Pill tone="info">MESSAGE</Pill>
            </View>
            {q.message && <Text className="mt-2 text-[14px] leading-[20px] text-ink">{q.message}</Text>}
            <View className="mt-3 flex-row flex-wrap gap-2">
              {q.phone && (
                <>
                  <Pressable
                    onPress={() => Linking.openURL(`tel:${q.phone}`)}
                    className="flex-row items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2"
                  >
                    <Icon name="phone" size={15} color="#5fa3f0" />
                    <Text className="text-[13px] font-semibold text-flame">Call</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => Linking.openURL(`sms:${q.phone}`)}
                    className="flex-row items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2"
                  >
                    <Icon name="message" size={15} color="#5fa3f0" />
                    <Text className="text-[13px] font-semibold text-flame">Text</Text>
                  </Pressable>
                </>
              )}
              {q.email && (
                <Pressable
                  onPress={() => Linking.openURL(`mailto:${q.email}`)}
                  className="flex-row items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2"
                >
                  <Icon name="mail" size={15} color="#5fa3f0" />
                  <Text className="text-[13px] font-semibold text-flame">Email</Text>
                </Pressable>
              )}
            </View>
          </Card>
        ))}

        {calls.length > 0 && (
          <Card>
            <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Call taps</Text>
            <Text className="mt-1 text-[13px] text-muted">
              People who tapped Call on your profile. Their number shows on your phone as a normal call.
            </Text>
            {calls.slice(0, 20).map((q) => (
              <View key={q.id} className="flex-row items-center justify-between border-b border-line-soft py-2">
                <Text className="text-[13px] text-ink">{when(q.createdAt)}</Text>
                <Text className="text-[12px] text-muted">{SOURCE[q.source ?? ""] ?? "Profile"}</Text>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
