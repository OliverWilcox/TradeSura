import { useCallback, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Pressable } from "react-native";
import { useFocusEffect, router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Pill, Button } from "@/components/ui";

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  applianceLabel: string | null;
  lastServicedAt: string | null;
  status: "ACTIVE" | "LAPSED" | "NONE";
  tierName: string | null;
  priceMonthlyPence: number | null;
};

type Counts = { all: number; onPlan: number; lapsed: number };

function statusPill(c: Customer) {
  if (c.status === "ACTIVE") {
    return (
      <Pill tone="ok">
        {(c.tierName ?? "PLAN").toUpperCase()} £{((c.priceMonthlyPence ?? 0) / 100).toFixed(0)}
      </Pill>
    );
  }
  if (c.status === "LAPSED") return <Pill tone="warn">LAPSED</Pill>;
  return <Pill tone="off">NO PLAN</Pill>;
}

// Screen 05 — customer book.
export default function Customers() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
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

  const shown = customers ? (showAll ? customers : customers.slice(0, 8)) : [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader right={<Micro className="text-[#AEB9C4]">Customers</Micro>} />
      </SafeAreaView>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-3.5 px-4 pb-8 pt-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Text className="font-sans text-sm text-danger">{error}</Text>}

        {counts && (
          <Card className="p-3">
            <View className="flex-row flex-wrap gap-1.5">
              <Pill tone="info">ALL {counts.all}</Pill>
              <Pill tone="ok">ON PLAN {counts.onPlan}</Pill>
              <Pill tone="off">NO PLAN {counts.all - counts.onPlan - counts.lapsed}</Pill>
              <Pill tone="warn">LAPSED {counts.lapsed}</Pill>
            </View>
          </Card>
        )}

        {shown.length > 0 && (
          <Card>
            {shown.map((c) => (
              <View
                key={c.id}
                className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2 last:border-b-0"
              >
                <View className="shrink">
                  <Text className="font-sans-bold text-sm text-ink">
                    {c.firstName} {c.lastName}
                  </Text>
                  <Micro>
                    {c.applianceLabel ? c.applianceLabel.toUpperCase() : c.phone}
                    {c.lastServicedAt &&
                      ` · SERVICED ${new Date(c.lastServicedAt)
                        .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                        .toUpperCase()}`}
                  </Micro>
                </View>
                {statusPill(c)}
              </View>
            ))}
            {!showAll && customers && customers.length > 8 && (
              <Pressable onPress={() => setShowAll(true)} className="pt-2.5">
                <Text className="text-center font-sans-semibold text-sm text-flame-deep">
                  View all {customers.length} customers →
                </Text>
              </Pressable>
            )}
          </Card>
        )}

        <Card>
          <Text className="mb-1 font-sans-semibold text-sm text-ink">Import your book</Text>
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
