import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable, Alert } from "react-native";
import { useFocusEffect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Pill, Button, ScreenTitle, SectionHeading } from "@/components/ui";
import { Skeleton, Bone, TextBone } from "@/components/skeleton";

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

// Build Guide v2 Part 11 — "the calendar is a compact week strip... it earns
// more size only with content." Replaces the old full month grid: this
// shows the current Mon–Sun only, with a dot under days that have a job.
function WeekStrip({ jobDates }: { jobDates: Set<string> }) {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const key = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <Card>
      <View className="flex-row">
        {days.map((d, i) => {
          const isToday = key(d) === key(today);
          const hasJob = jobDates.has(key(d));
          return (
            <View key={i} className="flex-1 items-center gap-1 py-1">
              <Text className="tabular-nums text-[10px] text-faint">{WEEKDAYS[i]}</Text>
              <View
                className={`h-7 w-7 items-center justify-center rounded-lg ${isToday ? "bg-flame" : ""}`}
              >
                <Text className={`text-xs ${isToday ? "font-semibold text-white" : "text-ink"}`}>
                  {d.getDate()}
                </Text>
              </View>
              <View
                className={`h-1 w-1 rounded-full ${hasJob ? "bg-flame" : "bg-transparent"}`}
              />
            </View>
          );
        })}
      </View>
    </Card>
  );
}

// Build Guide v2 Part 11 — "Rows show what the machine did or will do
// ('Reminder sent — she can reply to book.' / '3-day text goes out
// Tuesday.')." The reminder engine's actual sends live in OutboundSms, but
// its offsets (30/14/3 days) are fixed, so which one is next is derivable
// straight from the due date without a second query.
const REMINDER_OFFSETS = [30, 14, 3] as const;

function reminderLine(dueDate: Date): string {
  const daysUntilDue = (dueDate.getTime() - Date.now()) / 864e5;
  const nextOffset = REMINDER_OFFSETS.find((o) => daysUntilDue >= o);
  if (nextOffset === undefined) return "Reminder sent — they can reply to book.";
  const sendDate = new Date(dueDate);
  sendDate.setDate(sendDate.getDate() - nextOffset);
  const weekday = sendDate.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
  return `${nextOffset}-day text goes out ${weekday}.`;
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
    <Pressable
      onPress={() => router.push(`/customer/${d.customerId}`)}
      className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
    >
      <View className="shrink">
        <Text className="font-bold text-sm text-ink">{d.customerName}</Text>
        <Micro>
          {d.onPlan ? `ANNUAL SERVICE · ${d.tierName?.toUpperCase()} PLAN` : "ANNUAL SERVICE · NO PLAN"}
          {d.hasCp12 && " · CP12"}
          {" · "}
          {new Date(d.dueDate)
            .toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Europe/London" })
            .toUpperCase()}
        </Micro>
        {d.onPlan ? (
          <Text className="mt-0.5 font-sans text-[11px] text-muted">
            {reminderLine(new Date(d.dueDate))}
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
        <Pill tone="info">AUTO</Pill>
      ) : onOffer ? (
        <Button variant="flame" className="px-3 py-1.5" onPress={onOffer} disabled={offerBusy}>
          {offerBusy ? "…" : "Book + offer"}
        </Button>
      ) : (
        <Pill tone="off">NO PLAN</Pill>
      )}
    </Pressable>
  );
}

// Screen 07 — service calendar & reminders (lite).
// Intro, the (real, empty) week strip, then next and past jobs as rows.
function JobsSkeleton() {
  return (
    <Skeleton label="Loading your reminders" className="gap-3.5">
      <View>
        <TextBone width="95%" size={14} />
        <TextBone width="60%" size={14} />
      </View>
      <WeekStrip jobDates={new Set()} />
      {[3, 2].map((rows, card) => (
        <Card key={card}>
          <TextBone width={80} size={14} style={{ marginBottom: 4 }} />
          {Array.from({ length: rows }, (_, i) => (
            <View
              key={i}
              className={`flex-row items-center justify-between gap-2 py-2.5 ${i < rows - 1 ? "border-b border-line-soft" : ""}`}
            >
              <View className="flex-1">
                <TextBone width={[130, 110, 150][i]} size={14} />
                <TextBone width={[180, 160, 200][i]} size={11} />
              </View>
              <Bone width={64} height={22} radius={11} />
            </View>
          ))}
        </Card>
      ))}
    </Skeleton>
  );
}

export default function Jobs() {
  const { me } = useAuth();
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
  // Part 11 — the strip only ever shows this Mon–Sun, so it only needs to
  // know which of those 7 dates have a job.
  const jobDates = new Set(upcoming.map((d) => new Date(d.dueDate).toISOString().slice(0, 10)));

  const nextJobs = showAllNext ? upcoming : upcoming.slice(0, 3);
  const pastJobs = data ? (showAllPast ? data.past : data.past.slice(0, 3)) : [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <ScreenTitle
          title="Reminders"
          intro="Services coming up. Plan members are reminded and booked automatically; everyone else is a one-tap pitch."
        />
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {!data && !error && <JobsSkeleton />}

        {data && (
          <>
            <WeekStrip jobDates={jobDates} />

            {data.overdue.length > 0 && (
              <Card>
                <SectionHeading className="mb-1">Overdue</SectionHeading>
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
                <SectionHeading>Next jobs</SectionHeading>
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
                <SectionHeading>Past jobs</SectionHeading>
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
                          .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" })
                          .toUpperCase()}
                      </Micro>
                    </View>
                    <Pill tone="info">DONE</Pill>
                  </View>
                ))
              )}
            </Card>

            <Card>
              <SectionHeading className="mb-1">Reminder engine</SectionHeading>
              <View className="flex-row items-center justify-between border-b border-line-soft py-2.5">
                <Text className="font-sans text-sm text-ink">Customer reminders</Text>
                <Pill tone="info">AUTO · SMS · 30/14/3 DAYS</Pill>
              </View>
              <View className="flex-row items-center justify-between border-b border-line-soft py-2.5">
                <Text className="font-sans text-sm text-ink">Booking</Text>
                <Text className="font-sans text-xs text-muted">Customer replies to book</Text>
              </View>
              {/* Part 11 — "Tapping a row opens that customer's detail,
                  where Mark service done lives — the footer line says so." */}
              <Text className="pt-2.5 font-sans text-[11px] text-faint">
                Tap a job to open their page — Mark service done lives there.
              </Text>
            </Card>

            {/* Build Review 2 — nothing to offer (no live plan) or no one to
                offer it to: grey it out and point at setup, like the other
                locked buttons. */}
            {me?.hasPlan && (me?.customerCount ?? 0) > 0 ? (
              <Button variant="copper" onPress={() => router.push("/offer")}>
                Offer a plan to a no-plan customer
              </Button>
            ) : (
              <>
                <Button variant="copper" disabled onPress={() => {}}>
                  Offer a plan to a no-plan customer
                </Button>
                {me?.role === "staff" ? (
                  <Text className="text-center font-sans text-xs text-muted">
                    {me?.hasPlan ? "Add a customer first." : "The business has no live plan yet — ask the owner."}
                  </Text>
                ) : (
                  <Button variant="ghost" onPress={() => router.push("/onboarding")}>
                    {me?.hasPlan ? "Add your customers first — Continue setup" : "Make a plan live first — Continue setup"}
                  </Button>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
