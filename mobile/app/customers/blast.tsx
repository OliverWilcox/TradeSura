import { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

type Tier = { id: string; name: string; priceMonthlyPence: number };
type Results = { sent: number; visits: number; plansLive: number; since: string };
type Data = { noPlan: number; tiers: Tier[]; results: Results | null };

export default function Blast() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sent: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/customers/blast"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ sent: number }>("/api/customers/blast", {
        method: "POST",
        body: JSON.stringify({ confirmOwn: true }),
      });
      setDone(r);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send.");
    } finally {
      setBusy(false);
    }
  }

  const cheapest = data?.tiers[0];
  const priceLabel = cheapest ? `£${(cheapest.priceMonthlyPence / 100).toFixed(0)}` : "£12";

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Offer campaign" />
      </SafeAreaView>
      <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {done ? (
          <Card className="border-[#BFE8D2] bg-ok-tint">
            <Text className="font-semibold text-sm text-ok">
              Sent to {done.sent} customer{done.sent === 1 ? "" : "s"}
            </Text>
            <Text className="mt-1 font-sans text-xs text-muted">
              Messages go out over the next 10 minutes. Replies land on your number. We&apos;ll
              show the results here in a few days.
            </Text>
            <Button variant="ghost" className="mt-3" onPress={() => router.back()}>
              Done
            </Button>
          </Card>
        ) : (
          data && (
            <>
              <Card>
                <Text className="font-semibold text-sm text-ink">One-tap campaign</Text>
                <View className="mt-1.5 flex-row items-center justify-between">
                  <Text className="font-sans text-sm text-muted">Audience</Text>
                  <Text className="font-bold text-sm text-ink">
                    {data.noPlan} no-plan customer{data.noPlan === 1 ? "" : "s"}
                  </Text>
                </View>
                <View className="mt-1 flex-row items-center justify-between">
                  <Text className="font-sans text-sm text-muted">Channel</Text>
                  <Text className="font-bold text-sm text-ink">SMS · from your name</Text>
                </View>
              </Card>

              <Card>
                <Micro className="mb-1.5">Their message (fixed)</Micro>
                <View className="rounded-[10px] border border-line bg-panel p-3">
                  <Text className="font-sans text-[12.5px] text-ink">
                    Hi &#123;first name&#125; — it&apos;s {"{your trading name}"}. I now offer a
                    care plan: annual service, priority call-outs, no call-out fees, from{" "}
                    {priceLabel}/mo. Have a look: {"{link}"}
                    {"\n"}
                    <Text className="text-faint">Text STOP to opt out</Text>
                  </Text>
                </View>
              </Card>

              <Pressable
                onPress={() => setConfirmed((v) => !v)}
                className="flex-row items-start gap-2.5 px-1"
              >
                <View
                  className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${confirmed ? "border-flame bg-flame" : "border-line"}`}
                >
                  {confirmed && <Text className="text-[11px] text-white">✓</Text>}
                </View>
                <Text className="flex-1 font-sans text-[13px] text-muted">
                  These are my own customers — people I&apos;ve done work for or who&apos;ve asked
                  me to.
                </Text>
              </Pressable>

              {data.results && (
                <Card className="border-[#E1E8F0] bg-copper-tint">
                  <Micro className="text-copper-deep">Your last campaign</Micro>
                  <Text className="mt-0.5 font-sans text-xs text-copper-deep">
                    {data.results.sent} sent · {data.results.visits} page visit
                    {data.results.visits === 1 ? "" : "s"} · {data.results.plansLive} plan
                    {data.results.plansLive === 1 ? "" : "s"} live
                  </Text>
                </Card>
              )}

              <Button
                onPress={send}
                disabled={busy || !confirmed || data.noPlan === 0}
              >
                {busy
                  ? "Sending…"
                  : `Send to ${data.noPlan} customer${data.noPlan === 1 ? "" : "s"}`}
              </Button>
            </>
          )
        )}
      </ScrollView>
    </View>
  );
}
