import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill } from "@/components/ui";

type Pack = { code: string; name: string; anchor: string; live: boolean; registered: boolean };

// Trades & TradePacks — restored to mobile scope 2026-08-03 (see CLAUDE.md).
export default function Trades() {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPacks(await api<Pack[]>("/api/trades"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load trades.");
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

  async function register(code: string) {
    setBusy(code);
    try {
      await api("/api/trades/interest", { method: "POST", body: JSON.stringify({ code }) });
      setPacks((prev) => prev?.map((p) => (p.code === code ? { ...p, registered: true } : p)) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't register interest.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader right={<Micro className="text-[#AEB9C4]">Trades</Micro>} />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        <Card className="border-[#BBDCF4] bg-flame-tint">
          <Text className="font-sans text-xs text-flame-deep">
            <Text className="font-sans-semibold">One pack per trade.</Text> A trade only gets a
            care plan where a recurring service event anchors it — that annual visit is what makes
            the plan honest. Register interest and we&apos;ll tell you when your pack&apos;s
            clause library clears legal review.
          </Text>
        </Card>

        {packs && (
          <Card>
            {packs.map((p) => (
              <View
                key={p.code}
                className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
              >
                <View className="shrink">
                  <Text className="font-sans-bold text-sm text-ink">{p.name}</Text>
                  <Micro>{p.anchor}</Micro>
                </View>
                {p.live ? (
                  <Pill tone="ok">LIVE</Pill>
                ) : p.registered ? (
                  <Pill tone="info">INTEREST REGISTERED</Pill>
                ) : (
                  <Pressable onPress={() => register(p.code)} disabled={busy === p.code}>
                    <Text
                      className={`font-sans-semibold text-xs ${busy === p.code ? "text-faint" : "text-flame-deep"}`}
                    >
                      {busy === p.code ? "…" : "Register interest →"}
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
