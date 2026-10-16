import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, useLocalSearchParams, router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Skeleton, Bone, TextBone } from "@/components/skeleton";
import { AppHeader, Card, Pill, Button } from "@/components/ui";

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  source: string;
  applianceLabel: string | null;
  lastServicedAt: string | null;
  status: "ACTIVE" | "PAUSED" | "LAPSED" | "NONE";
  tierName: string | null;
  priceMonthlyPence: number | null;
  neverOffered: boolean;
  offeredAt: string | null;
  activatedAt: string | null;
  staleOffer: boolean;
  paymentIssue: boolean;
  tierId: string | null;
};

type Counts = { all: number; onPlan: number; notOnPlan: number; lapsed: number; attention: number };
type Segment = "all" | "plan" | "noplan" | "attention";

// Build Guide v2 Part 10 — the exact status-line patterns: "Never offered" ·
// "Offered N days ago" · "{Plan} — joined this week" · "{Plan} — since
// {month}".
function statusLine(c: Customer): string {
  if (c.status === "ACTIVE" || c.status === "PAUSED") {
    const plan = c.tierName ?? "plan";
    if (c.status === "PAUSED") return `${plan} — paused`;
    if (c.activatedAt) {
      const days = (Date.now() - new Date(c.activatedAt).getTime()) / 864e5;
      if (days < 7) return `${plan} — joined this week`;
      const month = new Date(c.activatedAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
      return `${plan} — since ${month}`;
    }
    return plan;
  }
  if (c.status === "LAPSED") return "Plan cancelled";
  if (c.neverOffered) return "Never offered";
  if (c.offeredAt) {
    const days = Math.round((Date.now() - new Date(c.offeredAt).getTime()) / 864e5);
    return `Offered ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}`;
  }
  return "Not on plan";
}

function pill(c: Customer) {
  if (c.paymentIssue) return <Pill tone="warn">PAYMENT ISSUE</Pill>;
  if (c.status === "ACTIVE") return <Pill tone="info">ON PLAN</Pill>;
  if (c.status === "PAUSED") return <Pill tone="warn">PAUSED</Pill>;
  if (c.status === "LAPSED") return <Pill tone="off">LAPSED</Pill>;
  if (c.neverOffered) return <Pill tone="off">NOT OFFERED</Pill>;
  return <Pill tone="info">OFFERED</Pill>;
}

// Segment pills plus a card of rows — name, status line, pill — until the
// book arrives (otherwise the empty-state copy flashes up first).
function CustomersSkeleton() {
  return (
    <Skeleton label="Loading your customers" className="gap-3.5">
      <View className="flex-row flex-wrap gap-1.5">
        {[52, 76, 96, 112].map((w) => (
          <Bone key={w} width={w} height={31} radius={16} />
        ))}
      </View>
      <Card>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <View
            key={i}
            className={`flex-row items-center justify-between gap-2 py-2.5 ${i < 5 ? "border-b border-line-soft" : ""}`}
          >
            <View className="flex-1">
              <TextBone width={[130, 110, 150, 120, 100, 140][i]} size={14} />
              <TextBone width={[170, 150, 190, 140, 160, 180][i]} size={11} />
            </View>
            <Bone width={72} height={22} radius={11} />
          </View>
        ))}
      </Card>
    </Skeleton>
  );
}

export default function Customers() {
  // Part 7.4 — the plan hub's "View customers" button: "a deep link with the
  // filter set, no new screen."
  const { tierId: planFilter, planName } = useLocalSearchParams<{ tierId?: string; planName?: string }>();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [segment, setSegment] = useState<Segment>("all");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importConsent, setImportConsent] = useState(false);
  const [salesByEngineer, setSalesByEngineer] = useState<{ name: string; plans: number }[] | null>(null);
  const { me } = useAuth();
  const isStaff = me?.role === "staff";

  const load = useCallback(async () => {
    try {
      const data = await api<{
        customers: Customer[];
        counts: Counts;
        salesByEngineer?: { name: string; plans: number }[];
      }>("/api/customers");
      setCustomers(data.customers);
      setCounts(data.counts);
      setSalesByEngineer(data.salesByEngineer ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load your customers.");
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

  async function pickCsv() {
    setImportError(null);
    setImportResult(null);
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*" });
    if (result.canceled || !result.assets[0]) return;
    const file = result.assets[0];
    setImporting(true);
    try {
      const form = new FormData();
      form.append(
        "file",
        { uri: file.uri, name: file.name, type: file.mimeType ?? "text/csv" } as unknown as Blob,
      );
      // Part 10 — the own-customers PECR checkbox, now required server-side
      // for the CSV path too (see /api/customers/import).
      form.append("confirmOwn", "1");
      const data = await api<{ imported: number; updated: number; skipped: number }>(
        "/api/customers/import",
        { method: "POST", body: form },
      );
      setImportResult(`${data.imported} imported, ${data.updated} updated, ${data.skipped} skipped.`);
      await load();
    } catch (e) {
      setImportError(e instanceof ApiError ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  const filtered = useMemo(() => {
    if (!customers) return [];
    if (planFilter) return customers.filter((c) => c.tierId === planFilter);
    switch (segment) {
      case "plan":
        return customers.filter((c) => c.status === "ACTIVE" || c.status === "PAUSED");
      case "noplan":
        return customers.filter((c) => c.status === "NONE");
      case "attention":
        return customers.filter((c) => c.paymentIssue || c.status === "LAPSED");
      default:
        return customers;
    }
  }, [customers, segment, planFilter]);

  const shown = showAll ? filtered : filtered.slice(0, 10);

  const tabs: { key: Segment; label: string; n: number }[] = counts
    ? [
        { key: "all", label: "All", n: counts.all },
        { key: "plan", label: "On plan", n: counts.onPlan },
        { key: "noplan", label: "Not on plan", n: counts.notOnPlan },
        { key: "attention", label: "Payment issues", n: counts.attention },
      ]
    : [];

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
        {planFilter && (
          <View className="flex-row items-center justify-between rounded-xl border border-flame bg-flame-tint px-3 py-2">
            <Text className="flex-1 font-sans text-xs text-flame" numberOfLines={1}>
              Showing customers on {planName || "this plan"}
            </Text>
            <Pressable onPress={() => router.replace("/(tabs)/(customers)/customers")}>
              <Text className="font-semibold text-xs text-flame-deep">Clear ×</Text>
            </Pressable>
          </View>
        )}
        <Text className="text-[28px] font-extrabold tracking-tight text-ink">Customers</Text>
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {tabs.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5">
            {tabs.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => {
                  setSegment(t.key);
                  setShowAll(false);
                }}
                className={`rounded-full border-[1.5px] px-3 py-1.5 ${segment === t.key ? "border-flame bg-flame-tint" : "border-line bg-paper"}`}
              >
                <Text
                  className={`font-semibold text-[12px] ${segment === t.key ? "text-flame-deep" : "text-muted"}`}
                >
                  {t.label} {t.n}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {customers === null ? (
          error ? null : <CustomersSkeleton />
        ) : shown.length > 0 ? (
          <Card>
            {shown.map((c) => (
              <View
                key={c.id}
                className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
              >
                <Pressable className="shrink" onPress={() => router.push(`/customer/${c.id}`)}>
                  <Text className="font-bold text-sm text-ink">
                    {c.firstName} {c.lastName}
                  </Text>
                  <Text className="font-sans text-[11px] text-muted">{statusLine(c)}</Text>
                </Pressable>
                {/* Part 10 LAW — the Offer button appears only on
                    never-offered rows; the one-nudge law extends here — an
                    already-offered customer doesn't get a second button, the
                    48h nudge machinery covers them. */}
                {c.status === "NONE" && c.neverOffered ? (
                  <Button
                    variant="flame"
                    className="px-3 py-1.5"
                    onPress={() =>
                      router.push({ pathname: "/offer", params: { customerId: c.id } })
                    }
                  >
                    Offer
                  </Button>
                ) : (
                  pill(c)
                )}
              </View>
            ))}
            {!showAll && filtered.length > 10 && (
              <Pressable onPress={() => setShowAll(true)} className="pt-2.5">
                <Text className="text-center font-semibold text-sm text-flame-deep">
                  View all {filtered.length} →
                </Text>
              </Pressable>
            )}
          </Card>
        ) : (
          <Card>
            <Text className="py-2 text-center font-sans text-sm text-muted">
              {segment === "noplan"
                ? counts?.all === 0
                  ? "Your book is empty — add a customer or import below."
                  : "Everyone in your book is on a plan."
                : "Nothing here."}
            </Text>
          </Card>
        )}

        {/* Part 10 — "doctrine naming, same verb as route 2" (the offer
            sheet's "Text them the offer"). */}
        {!isStaff && counts && counts.notOnPlan > 0 && segment === "noplan" && (
          <Button onPress={() => router.push("/customers/blast")}>
            {`Text the offer to ${counts.notOnPlan} customer${counts.notOnPlan === 1 ? "" : "s"}`}
          </Button>
        )}

        {/* Section 8 — sales by engineer, for paying staff bonuses. Counts of
            live plans each person signed up; never shown to staff. */}
        {!isStaff && salesByEngineer && salesByEngineer.length > 0 && (
          <Card>
            <Text className="mb-1 font-semibold text-sm text-ink">Sales by engineer</Text>
            {salesByEngineer.map((r) => (
              <View key={r.name} className="flex-row justify-between border-b border-line-soft py-2 last:border-b-0">
                <Text className="font-sans text-sm text-ink">{r.name}</Text>
                <Text className="font-mono text-sm text-ink">
                  {r.plans} plan{r.plans === 1 ? "" : "s"}
                </Text>
              </View>
            ))}
          </Card>
        )}

        {/* Part 10 — "Import can't be the only way in." */}
        <Pressable onPress={() => router.push("/add-customer")} className="items-center py-1">
          <Text className="font-semibold text-sm text-flame-deep">Add a customer by hand</Text>
        </Pressable>

        {/* Section 8 — importing the book is an owner action. */}
        {!isStaff && (
          <>
            <Card>
              <Text className="mb-1 font-semibold text-sm text-ink">Import your book</Text>
              <Text className="mb-2.5 font-sans text-xs text-muted">
                CSV, or pick from your phone&apos;s contacts. We de-dupe by phone number
                automatically.
              </Text>
              <Pressable
                onPress={() => setImportConsent((v) => !v)}
                className="mb-2.5 flex-row items-start gap-2.5"
              >
                <View
                  className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${importConsent ? "border-flame bg-flame" : "border-line"}`}
                >
                  {importConsent && <Text className="text-[11px] text-white">✓</Text>}
                </View>
                <Text className="flex-1 font-sans text-[13px] text-muted">
                  These are my own customers — people I&apos;ve done work for or who&apos;ve asked me
                  to.
                </Text>
              </Pressable>
              <Button variant="ghost" onPress={pickCsv} disabled={importing || !importConsent}>
                {importing ? "Importing…" : "Import CSV"}
              </Button>
              {/* Both routes need the box ticked — it's our PECR basis for
                  contacting them (Build Review 2). */}
              <Button
                variant="ghost"
                className="mt-2"
                onPress={() => router.push({ pathname: "/customers/import-contacts", params: { consent: "1" } })}
                disabled={importing || !importConsent}
              >
                Import from contacts
              </Button>
              {importResult && <Text className="mt-2 font-sans text-xs text-ink">{importResult}</Text>}
              {importError && <Text className="mt-2 font-sans text-xs text-danger">{importError}</Text>}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
