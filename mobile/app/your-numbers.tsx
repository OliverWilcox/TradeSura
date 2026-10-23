import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, RowLine, ScreenTitle, SectionHeading } from "@/components/ui";
import { CenteredSpinner } from "@/components/skeleton";

type Numbers = {
  livePlans: number;
  cancellations: {
    requests: number;
    stayed: number;
    cancelled: number;
    reasons: { reason: string; label: string; requests: number; stayed: number }[];
  };
  ratings: {
    average: number | null;
    count: number;
    isNew: boolean;
    recent: { id: string; stars: number; comment: string | null; customerName: string | null; ratedAt: string; reply: string | null }[];
  };
  enquiries: { total: number; calls: number; messages: number };
  website: { live: boolean; soldThisMonth: number };
};

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

// Section 10 — the installer's own version of the admin numbers:
// cancellation reasons, ratings, enquiries and website sales.
export default function YourNumbers() {
  const [data, setData] = useState<Numbers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Numbers>("/api/me/numbers"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your numbers.");
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
        <AppHeader title="Your numbers" />
      </SafeAreaView>
      {!data ? (
        error ? (
          <Text className="p-6 text-center text-sm text-danger">{error}</Text>
        ) : (
          <CenteredSpinner label="Loading your numbers" />
        )
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <ScreenTitle title="Your numbers" intro="How you're keeping customers and winning new ones." />

          <Card>
            <SectionHeading>Ratings</SectionHeading>
            <Text className="mt-1.5 text-[19px] font-bold text-ink">
              {data.ratings.isNew || data.ratings.average === null
                ? `New to TradeSura · ${data.ratings.count} rating${data.ratings.count === 1 ? "" : "s"}`
                : `${data.ratings.average.toFixed(1)} from ${data.ratings.count} verified customers`}
            </Text>
            {data.ratings.recent.map((r) => (
              <View key={r.id} className="border-b border-line-soft py-2">
                <Text className="text-[13px] text-warn">{stars(r.stars)}</Text>
                {r.comment && <Text className="mt-0.5 text-[13px] text-ink">&ldquo;{r.comment}&rdquo;</Text>}
                <Text className="mt-0.5 text-[12px] text-muted">
                  {r.customerName ?? "Customer"} · {r.reply ? "Replied" : "No reply yet"}
                </Text>
              </View>
            ))}
            {data.ratings.recent.length === 0 && (
              <Text className="mt-1 text-[13px] text-muted">Customers are asked to rate after each logged service.</Text>
            )}
          </Card>

          <Card>
            <SectionHeading>Cancellations · last 90 days</SectionHeading>
            <Text className="mt-1.5 text-[14px] text-ink">
              {data.cancellations.requests} asked to cancel · {data.cancellations.stayed} stayed ·{" "}
              {data.cancellations.cancelled} left · {data.livePlans} plans live now
            </Text>
            {data.cancellations.reasons.map((r) => (
              <RowLine
                key={r.reason}
                left={r.label}
                right={`${r.requests}${r.stayed ? ` · ${r.stayed} stayed` : ""}`}
              />
            ))}
          </Card>

          <Pressable onPress={() => router.push("/enquiries")}>
            <Card>
              <SectionHeading>Enquiries · this month</SectionHeading>
              <Text className="mt-1.5 text-[19px] font-bold text-ink">
                TradeSura sent you {data.enquiries.total} enquir{data.enquiries.total === 1 ? "y" : "ies"}
              </Text>
              <Text className="mt-1 text-[13px] text-muted">
                {data.enquiries.messages} message{data.enquiries.messages === 1 ? "" : "s"} · {data.enquiries.calls} call
                {data.enquiries.calls === 1 ? "" : "s"} — tap to see them
              </Text>
            </Card>
          </Pressable>

          <Pressable onPress={() => router.push("/website")}>
            <Card>
              <SectionHeading>Website · this month</SectionHeading>
              <Text className="mt-1.5 text-[19px] font-bold text-ink">
                {data.website.live
                  ? `Your website sold ${data.website.soldThisMonth} plan${data.website.soldThisMonth === 1 ? "" : "s"}`
                  : "Add TradeSura to your website"}
              </Text>
            </Card>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}
