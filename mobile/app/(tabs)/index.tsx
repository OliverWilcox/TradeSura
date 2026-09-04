import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

type DueItem = {
  customerId: string;
  customerName: string;
  dueDate: string;
  onPlan: boolean;
  tierName?: string;
  hasCp12: boolean;
  planId?: string;
};

type Dashboard = {
  totalPence: number;
  count: number;
  newThisMonth: number;
  failedRecently: number;
  noPlan: number;
  prizeYearlyPence: number;
  upcoming: DueItem[];
  nextPayoutPence: number | null;
  nextPayoutDate: string | null;
  referral: { name: string; activePlans: number; required: number } | null;
};

// Screen 02 — the money mirror. Greeting + a single primary action up top,
// then the numbers — the doorstep flow is what this screen exists to launch.
export default function Home() {
  const { me } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Dashboard>("/api/dashboard");
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your dashboard.");
    } finally {
      setLoading(false);
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

  const monogram = (me?.tradingName || me?.email || "??")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-paper">
        <AppHeader
          right={
            <Pressable
              onPress={() => router.push("/more")}
              className="h-8 w-8 items-center justify-center rounded-full bg-flame-tint"
            >
              <Text className="text-[11px] font-bold text-flame-deep">{monogram}</Text>
            </Pressable>
          }
        />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text className="text-[22px] font-extrabold tracking-tight text-ink">
          {me?.firstName ? `Hello, ${me.firstName}` : "Hello"}
        </Text>
        <Text className="-mt-2 text-sm text-muted">
          Offer a plan at the end of the job — most take under 90 seconds.
        </Text>

        {loading && !data && !error && (
          <View className="items-center py-10">
            <ActivityIndicator color="#5FA3F0" />
          </View>
        )}

        {error && <Text className="text-sm text-danger">{error}</Text>}
        {data && (
          <>
            <Card variant="hero">
              <Micro>Your plan income</Micro>
              <Text className="mt-0.5 text-[36px] font-extrabold leading-none text-copper">
                £{(data.totalPence / 100).toFixed(0)}
                <Text className="text-base font-bold text-muted"> /month</Text>
              </Text>
              <Text className="mt-1 text-[12.5px] text-muted">
                {data.count === 0 ? (
                  "Your first plan changes this"
                ) : (
                  <>
                    {data.count} active plan{data.count === 1 ? "" : "s"}
                    {data.newThisMonth > 0 && (
                      <Text className="font-bold text-ok"> · +{data.newThisMonth} this month</Text>
                    )}
                  </>
                )}
              </Text>
              {data.nextPayoutPence !== null && (
                <View className="mt-2.5 flex-row items-center justify-between border-t border-line-strong pt-2.5">
                  <Text className="text-[12.5px] text-muted">Next payout</Text>
                  <Text className="font-mono font-bold text-copper">
                    £{(data.nextPayoutPence / 100).toFixed(2)}
                    {data.nextPayoutDate
                      ? ` · ${new Date(data.nextPayoutDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`
                      : ""}
                  </Text>
                </View>
              )}
            </Card>

            {data.count === 0 && (
              <Card>
                <Micro>Get started</Micro>
                <Text className="mt-1 text-[15px] font-bold text-ink">Send your first offer</Text>
                <Text className="mt-1 text-[12.5px] text-muted">
                  One customer on a plan and this card becomes your income.
                </Text>
                <Button className="mt-3" onPress={() => router.push("/offer")}>
                  Offer a plan
                </Button>
              </Card>
            )}

            {data.noPlan >= 5 && (
              <Card className="border-[rgba(242,184,75,.3)] bg-warn-tint">
                <View className="flex-row items-center justify-between">
                  <View className="shrink">
                    <Text className="font-mono font-bold text-warn">
                      £{(data.prizeYearlyPence / 100).toFixed(0)}/yr not collected
                    </Text>
                    <Text className="mt-0.5 text-[12.5px] text-muted">
                      {data.noPlan} book customers aren&apos;t on a plan yet
                    </Text>
                  </View>
                  <Pressable onPress={() => router.push("/(tabs)/customers")}>
                    <Text className="font-bold text-warn">View →</Text>
                  </Pressable>
                </View>
              </Card>
            )}

            <Card>
              <Micro className="mb-1">Today</Micro>
              {data.upcoming.length > 0 && (
                <Pressable
                  className="flex-row gap-2 py-1.5"
                  onPress={() => router.push("/(tabs)/jobs")}
                >
                  <Text>🔧</Text>
                  <Text className="flex-1 text-[13px] text-ink">
                    <Text className="font-bold">
                      {data.upcoming.length} service{data.upcoming.length === 1 ? "" : "s"} due
                    </Text>{" "}
                    — {data.upcoming.map((d) => d.customerName.split(" ")[0]).join(", ")}
                  </Text>
                </Pressable>
              )}
              {data.failedRecently > 0 && (
                <Pressable
                  className="flex-row gap-2 py-1.5"
                  onPress={() => router.push("/payouts")}
                >
                  <Text>⏳</Text>
                  <Text className="flex-1 text-[13px] text-ink">
                    {data.failedRecently} payment{data.failedRecently === 1 ? "" : "s"} retrying —{" "}
                    <Text className="text-faint">Stripe handles it, no action yet</Text>
                  </Text>
                </Pressable>
              )}
              {data.referral && (
                <Pressable
                  className="flex-row gap-2 py-1.5"
                  onPress={() => router.push("/referral")}
                >
                  <Text>🤝</Text>
                  <Text className="flex-1 text-[13px] text-ink">
                    {data.referral.name}&apos;s nearly live —{" "}
                    <Text className="font-bold">
                      {data.referral.activePlans}/{data.referral.required} plans
                    </Text>{" "}
                    to your £50
                  </Text>
                </Pressable>
              )}
              {data.upcoming.length === 0 && data.failedRecently === 0 && !data.referral && (
                <Text className="py-1 text-xs text-muted">
                  Nothing needs you today. Tap the + below to offer a plan.
                </Text>
              )}
            </Card>

            <View className="flex-row gap-2.5">
              <Button variant="ghost" className="flex-1" onPress={() => router.push("/demo")}>
                📱 Show a customer
              </Button>
              <Button variant="ghost" className="flex-1" onPress={() => router.push("/referral")}>
                🤝 Invite an engineer
              </Button>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
