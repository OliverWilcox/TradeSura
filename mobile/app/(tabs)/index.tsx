import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, Link, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, RowLine, Button } from "@/components/ui";

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
};

function StatTile({
  label,
  value,
  sub,
  tone = "ok",
  onPress,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn";
  onPress?: () => void;
}) {
  const Wrap = onPress ? Pressable : View;
  return (
    <Wrap
      className="flex-1 rounded-xl border border-line bg-paper p-3.5"
      onPress={onPress}
      {...(onPress ? { hitSlop: 4 } : {})}
    >
      <Micro>{label}</Micro>
      <Text
        className={`mt-1 font-mono-semibold text-2xl ${tone === "ok" ? "text-ink" : "text-warn"}`}
      >
        {value}
      </Text>
      {sub && <Text className="mt-0.5 font-sans text-[11px] text-faint">{sub}</Text>}
    </Wrap>
  );
}

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
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader
          right={
            <View className="h-8 w-8 items-center justify-center rounded-full bg-white/15">
              <Text className="font-mono text-[11px] text-white">{monogram}</Text>
            </View>
          }
        />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text className="font-disp-bold text-[26px] uppercase tracking-wide text-ink">
          {me?.firstName ? `Hello, ${me.firstName}` : "Hello"}
        </Text>
        <Text className="-mt-2 font-sans text-sm text-muted">
          Offer a plan on the doorstep — most take under 90 seconds.
        </Text>

        <Link href="/offer" asChild>
          <Button variant="copper">Offer a plan — signed in 90 seconds</Button>
        </Link>

        {loading && !data && !error && (
          <View className="items-center py-10">
            <ActivityIndicator color="#0E7FD0" />
          </View>
        )}

        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
        {data && (
          <>
            <View className="rounded-[14px] border border-[#39434f] bg-iron-2 p-4">
              <View className="flex-row items-center gap-1.5">
                <Micro className="text-[#8FA0B0]">Locked-in income</Micro>
                <View
                  className={`h-2.5 w-2.5 rounded-full ${data.failedRecently < 2 ? "bg-flame" : "bg-warn"}`}
                />
              </View>
              <Text className="mt-1 font-mono-semibold text-[34px] leading-tight text-[#F3B27E]">
                £{(data.totalPence / 100).toFixed(0)}
                <Text className="font-mono text-base text-[#C9A17E]">/mo</Text>
              </Text>
              <Text className="mt-0.5 font-sans text-xs text-[#AEB9C4]">
                <Text>= </Text>
                <Text className="font-sans-semibold text-[#F3B27E]">
                  £{((data.totalPence * 12) / 100).toFixed(0)} a year
                </Text>
                <Text> · {data.count} active plan{data.count === 1 ? "" : "s"}</Text>
              </Text>
            </View>

            <View className="flex-row gap-3">
              <StatTile
                label="New this month"
                value={`+${data.newThisMonth}`}
                sub="New plans"
                onPress={() => router.push("/(tabs)/plans")}
              />
              <StatTile
                label="Failed collections"
                value={String(data.failedRecently)}
                sub="Last 30 days"
                tone={data.failedRecently > 0 ? "warn" : "ok"}
                onPress={() => router.push("/payouts")}
              />
            </View>

            {data.count === 0 && data.noPlan === 0 && (
              <Card className="border-[#BBDCF4] bg-flame-tint">
                <Text className="font-sans-semibold text-sm text-flame-deep">
                  Get your first plan on the board
                </Text>
                <Text className="mt-1 font-sans text-xs text-muted">
                  Import your customer book so you know who to offer a plan to — or head
                  straight to the doorstep flow above if you&apos;ve got someone in mind.
                </Text>
                <Pressable onPress={() => router.push("/(tabs)/customers")} className="mt-2.5">
                  <Text className="font-sans-semibold text-xs text-flame-deep">
                    Import your customer book →
                  </Text>
                </Pressable>
              </Card>
            )}

            <Card>
              <View className="mb-1 flex-row items-baseline justify-between">
                <Text className="font-sans-semibold text-sm text-ink">Upcoming appointments</Text>
                <Link href="/(tabs)/jobs" className="font-sans-semibold text-xs text-flame-deep">
                  View all →
                </Link>
              </View>
              {data.upcoming.length === 0 ? (
                <Text className="py-1 font-sans text-xs text-muted">
                  Nothing booked yet — service dates appear here from plan signups and your
                  customer import.
                </Text>
              ) : (
                data.upcoming.map((d, i) => (
                  <RowLine
                    key={i}
                    left={
                      <View>
                        <Text className="font-sans-semibold text-sm text-ink">
                          {d.customerName}
                        </Text>
                        <Text className="font-mono text-[10px] uppercase text-faint">
                          Annual service{d.tierName ? ` · ${d.tierName} plan` : " · no plan"}
                        </Text>
                      </View>
                    }
                    right={
                      <Text className="font-mono text-xs text-ink">
                        {new Date(d.dueDate).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </Text>
                    }
                  />
                ))
              )}
            </Card>

            {data.noPlan > 0 && (
              <Card className="border-[#EBCDB8] bg-copper-tint">
                <Text className="font-sans-semibold text-sm text-copper-deep">
                  You&apos;re leaving money on the van
                </Text>
                <Text className="mt-1 font-sans text-xs text-[#7A4A26]">
                  {data.noPlan} customer{data.noPlan === 1 ? "" : "s"} in your book{" "}
                  {data.noPlan === 1 ? "has" : "have"} no plan. Converting 1 in 5 adds{" "}
                  <Text className="font-mono-semibold">
                    £{(data.prizeYearlyPence / 100).toFixed(0)}/yr
                  </Text>
                  .
                </Text>
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
