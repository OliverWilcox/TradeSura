import { useCallback, useState } from "react";
import { View, Text, ScrollView, TextInput, KeyboardAvoidingView, Platform, RefreshControl } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Button, Pill, ScreenTitle } from "@/components/ui";

type Rating = {
  id: string;
  stars: number | null;
  comment: string | null;
  customerName: string | null;
  customerId: string;
  ratedAt: string;
  reply: string | null;
  repliedAt: string | null;
  removedReason: string | null;
};
type Data = { summary: { average: number | null; count: number; isNew: boolean }; ratings: Rating[] };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

// Section 5 — every rating customers have given, never filtered, each with
// one public reply.
export default function Ratings() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/ratings"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your ratings.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function sendReply(id: string) {
    setBusy(true);
    setReplyError(null);
    try {
      await api(`/api/ratings/${id}/reply`, { method: "POST", body: JSON.stringify({ reply: draft.trim() }) });
      setReplyingTo(null);
      setDraft("");
      await load();
    } catch (e) {
      setReplyError(e instanceof ApiError ? e.message : "Couldn't post your reply — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Ratings" />
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView
          contentContainerClassName="gap-3 px-4 pb-10 pt-4"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor="#5FA3F0"
            />
          }
        >
          <ScreenTitle
            title="Ratings"
            intro="Plan customers rate each service you log. Every rating shows on your public page — reply once to each."
          />
          {error && <Text className="text-sm text-danger">{error}</Text>}

          {data && (
            <Card variant="raised">
              <View className="flex-row items-center justify-between">
                <View>
                  <Text className="text-[28px] font-extrabold text-ink">
                    {data.summary.average !== null ? data.summary.average.toFixed(1) : "—"}
                    <Text className="text-base text-flame"> ★</Text>
                  </Text>
                  <Text className="text-xs text-muted">
                    {data.summary.count} verified TradeSura customer{data.summary.count === 1 ? "" : "s"}
                  </Text>
                </View>
                {data.summary.isNew && <Pill tone="info">NEW TO TRADESURA</Pill>}
              </View>
            </Card>
          )}

          {data && data.ratings.length === 0 && (
            <Card>
              <Text className="text-sm text-muted">
                No ratings yet. After you log a service for a plan customer, they get a one-tap link to rate it.
              </Text>
            </Card>
          )}

          {data?.ratings.map((r) => (
            <Card key={r.id}>
              <View className="flex-row items-center justify-between">
                <Text className="text-base text-flame">
                  {"★".repeat(r.stars ?? 0)}
                  <Text className="text-line-strong">{"★".repeat(5 - (r.stars ?? 0))}</Text>
                </Text>
                <Text className="text-[11px] text-faint">{day(r.ratedAt)}</Text>
              </View>
              <Text className="mt-1 text-xs text-muted">{r.customerName ?? "Customer"} · verified TradeSura customer</Text>
              {r.comment ? <Text className="mt-2 text-sm text-ink">“{r.comment}”</Text> : null}
              {r.removedReason ? (
                <Text className="mt-2 text-xs text-warn">Removed by TradeSura: {r.removedReason}</Text>
              ) : r.reply ? (
                <View className="mt-2.5 rounded-xl bg-line-soft px-3 py-2">
                  <Text className="text-[11px] font-bold text-muted">Your reply</Text>
                  <Text className="mt-0.5 text-sm text-ink">{r.reply}</Text>
                </View>
              ) : replyingTo === r.id ? (
                <View className="mt-2.5 gap-2">
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Your public reply"
                    placeholderTextColor="#6e86a3"
                    multiline
                    maxLength={600}
                    textAlignVertical="top"
                    className="min-h-[72px] rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-[16px] text-ink"
                  />
                  <Text className="text-[11px] text-faint">One reply per rating, shown publicly. You can&apos;t edit it later.</Text>
                  {replyError && <Text className="text-xs text-danger">{replyError}</Text>}
                  <Button onPress={() => sendReply(r.id)} disabled={busy || draft.trim().length < 2}>
                    {busy ? "Posting…" : "Post reply"}
                  </Button>
                  <Button variant="ghost" onPress={() => setReplyingTo(null)} disabled={busy}>
                    Cancel
                  </Button>
                </View>
              ) : (
                <Button
                  variant="ghost"
                  className="mt-2.5"
                  onPress={() => {
                    setReplyingTo(r.id);
                    setDraft("");
                    setReplyError(null);
                  }}
                >
                  Reply
                </Button>
              )}
            </Card>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
