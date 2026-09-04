import { useCallback, useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
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
  staleOffer: boolean;
  paymentIssue: boolean;
};

type Counts = { all: number; onPlan: number; notOnPlan: number; lapsed: number; attention: number };
type Segment = "all" | "plan" | "noplan" | "attention";

function statusLine(c: Customer): string {
  if (c.status === "ACTIVE") return `On ${c.tierName ?? "plan"} · £${((c.priceMonthlyPence ?? 0) / 100).toFixed(0)}/mo`;
  if (c.status === "PAUSED") return "Plan paused";
  if (c.status === "LAPSED") return "Plan cancelled";
  if (c.neverOffered) return "Never offered";
  if (c.staleOffer) return "Offer sent — no response";
  if (c.offeredAt) {
    const days = Math.round((Date.now() - new Date(c.offeredAt).getTime()) / 864e5);
    return `Offered ${days === 0 ? "today" : `${days}d ago`}`;
  }
  return "Not on plan";
}

function pill(c: Customer) {
  if (c.paymentIssue) return <Pill tone="warn">PAYMENT ISSUE</Pill>;
  if (c.status === "ACTIVE") return <Pill tone="ok">ON PLAN</Pill>;
  if (c.status === "PAUSED") return <Pill tone="warn">PAUSED</Pill>;
  if (c.status === "LAPSED") return <Pill tone="off">LAPSED</Pill>;
  if (c.neverOffered) return <Pill tone="off">NOT OFFERED</Pill>;
  return <Pill tone="info">OFFERED</Pill>;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [segment, setSegment] = useState<Segment>("noplan");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ customers: Customer[]; counts: Counts }>("/api/customers");
      setCustomers(data.customers);
      setCounts(data.counts);
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
  }, [customers, segment]);

  const shown = showAll ? filtered : filtered.slice(0, 10);

  const tabs: { key: Segment; label: string; n: number }[] = counts
    ? [
        { key: "all", label: "All", n: counts.all },
        { key: "plan", label: "On plan", n: counts.onPlan },
        { key: "noplan", label: "Not on plan", n: counts.notOnPlan },
        { key: "attention", label: "⚠", n: counts.attention },
      ]
    : [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Customers" />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
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

        {shown.length > 0 ? (
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
                {c.status === "NONE" ? (
                  <Button
                    variant={c.neverOffered ? "flame" : "ghost"}
                    className="px-3 py-1.5"
                    onPress={() =>
                      router.push({ pathname: "/offer", params: { customerId: c.id } })
                    }
                  >
                    {c.neverOffered ? "Offer" : "Re-offer"}
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
                ? "Everyone in your book is on a plan. 🎉"
                : "Nothing here."}
            </Text>
          </Card>
        )}

        {counts && counts.notOnPlan > 0 && segment === "noplan" && (
          <Button onPress={() => router.push("/customers/blast")}>
            {`Text ${counts.notOnPlan} no-plan customer${counts.notOnPlan === 1 ? "" : "s"} an offer`}
          </Button>
        )}

        <Card>
          <Text className="mb-1 font-semibold text-sm text-ink">Import your book</Text>
          <Text className="mb-2.5 font-sans text-xs text-muted">
            CSV, or pick from your phone&apos;s contacts. We de-dupe by phone number
            automatically.
          </Text>
          <Button variant="ghost" onPress={pickCsv} disabled={importing}>
            {importing ? "Importing…" : "Import CSV"}
          </Button>
          <Button
            variant="ghost"
            className="mt-2"
            onPress={() => router.push("/customers/import-contacts")}
          >
            Import from contacts
          </Button>
          {importResult && <Text className="mt-2 font-sans text-xs text-ok">{importResult}</Text>}
          {importError && <Text className="mt-2 font-sans text-xs text-danger">{importError}</Text>}
        </Card>
      </ScrollView>
    </View>
  );
}
