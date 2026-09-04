import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, Alert } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, Button } from "@/components/ui";

type DueItem = {
  customerId: string;
  customerName: string;
  dueDate: string;
  onPlan: boolean;
  tierName?: string;
  hasCp12: boolean;
  planId?: string;
};
type PastItem = {
  id: string;
  customerName: string;
  applianceLabel: string;
  lastServicedAt: string;
};
type JobsData = { upcoming: DueItem[]; overdue: DueItem[]; past: PastItem[] };

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function CalendarCard({ month, jobDates }: { month: Date; jobDates: Set<number> }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadBlanks = (first.getDay() + 6) % 7; // Monday-first
  const today = new Date();
  const isThisMonth =
    today.getMonth() === month.getMonth() && today.getFullYear() === month.getFullYear();

  const cells: (number | null)[] = [
    ...Array.from({ length: leadBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <Card>
      <Text className="mb-2 font-semibold text-sm text-ink">
        {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
      </Text>
      <View className="flex-row">
        {WEEKDAYS.map((d, i) => (
          <Text key={i} className="flex-1 py-1 text-center font-mono text-[10px] text-faint">
            {d}
          </Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} className="flex-row">
          {week.map((day, di) => {
            if (day === null) return <View key={di} className="flex-1 py-1.5" />;
            const hasJob = jobDates.has(day);
            const isToday = isThisMonth && today.getDate() === day;
            return (
              <View key={di} className="flex-1 items-center py-1.5">
                <View
                  className={`h-7 w-7 items-center justify-center rounded-lg ${
                    isToday ? "bg-flame" : hasJob ? "bg-flame-tint" : ""
                  }`}
                >
                  <Text
                    className={`text-xs ${
                      isToday
                        ? "font-semibold text-white"
                        : hasJob
                          ? "font-semibold text-flame-deep"
                          : "text-ink"
                    }`}
                  >
                    {day}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

function JobRow({
  d,
  urgent,
  onOffer,
  offerBusy,
}: {
  d: DueItem;
  urgent: boolean;
  onOffer?: () => void;
  offerBusy?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0">
      <View className="shrink">
        <Text className="font-bold text-sm text-ink">{d.customerName}</Text>
        <Micro>
          {d.onPlan ? `ANNUAL SERVICE · ${d.tierName?.toUpperCase()} PLAN` : "ANNUAL SERVICE · NO PLAN"}
          {d.hasCp12 && " · CP12"}
          {" · "}
          {new Date(d.dueDate)
            .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
            .toUpperCase()}
        </Micro>
        {d.onPlan ? (
          <Text className="mt-0.5 font-sans text-[11px] text-ok">
            ✓ We&apos;ve messaged them to book a weekday with you
          </Text>
        ) : (
          <Text className="mt-0.5 font-sans text-[11px] text-muted">
            Book it — and offer the plan at the perfect moment.
          </Text>
        )}
      </View>
      {urgent ? (
        <Pill tone="warn">URGENT</Pill>
      ) : d.onPlan ? (
        <Pill tone="ok">AUTO</Pill>
      ) : onOffer ? (
        <Button variant="flame" className="px-3 py-1.5" onPress={onOffer} disabled={offerBusy}>
          {offerBusy ? "…" : "Book + offer"}
        </Button>
      ) : (
        <Pill tone="off">NO PLAN</Pill>
      )}
    </View>
  );
}

// Screen 07 — service calendar & reminders (lite).
export default function Jobs() {
  const [data, setData] = useState<JobsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAllNext, setShowAllNext] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [reminding, setReminding] = useState<string | null>(null);

  async function sendReminder(customerId: string) {
    setReminding(customerId);
    try {
      await api("/api/jobs/remind", { method: "POST", body: JSON.stringify({ customerId }) });
      Alert.alert("Sent", "Your customer got a text to book the service, with your plan offer.");
    } catch (e) {
      Alert.alert("Couldn't send", e instanceof ApiError ? e.message : "Try again.");
    } finally {
      setReminding(null);
    }
  }

  const load = useCallback(async () => {
    try {
      const d = await api<JobsData>("/api/jobs");
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your jobs.");
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

  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 30);

  const upcoming = data?.upcoming ?? [];
  const hasJobThisMonth = upcoming.some((d) => {
    const dd = new Date(d.dueDate);
    return dd.getMonth() === now.getMonth() && dd.getFullYear() === now.getFullYear();
  });
  const calendarMonth =
    hasJobThisMonth || upcoming.length === 0 ? now : new Date(upcoming[0].dueDate);
  const jobDates = new Set(
    upcoming
      .map((d) => new Date(d.dueDate))
      .filter(
        (dd) => dd.getMonth() === calendarMonth.getMonth() && dd.getFullYear() === calendarMonth.getFullYear(),
      )
      .map((dd) => dd.getDate()),
  );

  const nextJobs = showAllNext ? upcoming : upcoming.slice(0, 3);
  const pastJobs = data ? (showAllPast ? data.past : data.past.slice(0, 3)) : [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Reminders" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {data && (
          <>
            <Text className="font-sans text-sm text-muted">
              Gas engineers fit and forget. You won&apos;t — plan members are reminded and booked
              automatically; everyone else is a one-tap pitch.
            </Text>
            <CalendarCard month={calendarMonth} jobDates={jobDates} />

            {data.overdue.length > 0 && (
              <Card>
                <Text className="mb-1 font-semibold text-sm text-ink">Overdue</Text>
                {data.overdue.map((d, i) => (
                  <JobRow
                    key={i}
                    d={d}
                    urgent
                    onOffer={d.onPlan ? undefined : () => sendReminder(d.customerId)}
                    offerBusy={reminding === d.customerId}
                  />
                ))}
              </Card>
            )}

            <Card>
              <View className="mb-1 flex-row items-baseline justify-between">
                <Text className="font-semibold text-sm text-ink">Next jobs</Text>
                {!showAllNext && upcoming.length > 3 && (
                  <Pressable onPress={() => setShowAllNext(true)}>
                    <Text className="font-semibold text-xs text-flame-deep">
                      View all {upcoming.length} →
                    </Text>
                  </Pressable>
                )}
              </View>
              {nextJobs.length === 0 ? (
                <Text className="py-1 font-sans text-xs text-muted">
                  Nothing coming up — jobs appear here from plan signups and the last-service
                  column of your customer import.
                </Text>
              ) : (
                nextJobs.map((d, i) => (
                  <JobRow
                    key={i}
                    d={d}
                    urgent={d.hasCp12 && new Date(d.dueDate) <= soon}
                    onOffer={d.onPlan ? undefined : () => sendReminder(d.customerId)}
                    offerBusy={reminding === d.customerId}
                  />
                ))
              )}
            </Card>

            <Card>
              <View className="mb-1 flex-row items-baseline justify-between">
                <Text className="font-semibold text-sm text-ink">Past jobs</Text>
                {!showAllPast && data.past.length > 3 && (
                  <Pressable onPress={() => setShowAllPast(true)}>
                    <Text className="font-semibold text-xs text-flame-deep">
                      View all {data.past.length} →
                    </Text>
                  </Pressable>
                )}
              </View>
              {pastJobs.length === 0 ? (
                <Text className="py-1 font-sans text-xs text-muted">
                  No completed services on record yet.
                </Text>
              ) : (
                pastJobs.map((a) => (
                  <View
                    key={a.id}
                    className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
                  >
                    <View className="shrink">
                      <Text className="font-bold text-sm text-ink">{a.customerName}</Text>
                      <Micro>
                        {a.applianceLabel.toUpperCase()} · SERVICED{" "}
                        {new Date(a.lastServicedAt)
                          .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                          .toUpperCase()}
                      </Micro>
                    </View>
                    <Pill tone="ok">DONE</Pill>
                  </View>
                ))
              )}
            </Card>

            <Card>
              <Text className="mb-1 font-semibold text-sm text-ink">Reminder engine</Text>
              <View className="flex-row items-center justify-between border-b border-line-soft py-2.5">
                <Text className="font-sans text-sm text-ink">Customer reminders</Text>
                <Pill tone="ok">AUTO · SMS · 30/14/3 DAYS</Pill>
              </View>
              <View className="flex-row items-center justify-between py-2.5">
                <Text className="font-sans text-sm text-ink">Booking</Text>
                <Text className="font-sans text-xs text-muted">Customer replies to book</Text>
              </View>
            </Card>

            <Button variant="copper" onPress={() => router.push("/offer")}>
              Offer a plan to a no-plan customer
            </Button>
          </>
        )}
      </ScrollView>
    </View>
  );
}
