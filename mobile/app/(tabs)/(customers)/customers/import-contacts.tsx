import { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Contacts from "expo-contacts";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Button } from "@/components/ui";

type PickedContact = { id: string; name: string; phone: string; email?: string };

// Screen 05 — phone-book import. expo-contacts' native picker
// (Contact.presentPicker()) only returns one contact at a time, so bulk
// import reads the address book and lets the engineer multi-select in-app —
// strictly better than the web version's Chrome-on-Android-only picker.
export default function ImportContacts() {
  const [status, setStatus] = useState<"loading" | "denied" | "ready" | "importing">("loading");
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      const perm = await Contacts.requestPermissionsAsync();
      if (perm.status !== "granted") {
        if (!stop) setStatus("denied");
        return;
      }
      const details = await Contacts.Contact.getAllDetails(
        [Contacts.ContactField.FULL_NAME, Contacts.ContactField.PHONES, Contacts.ContactField.EMAILS],
        { limit: 1000 },
      );
      const mapped: PickedContact[] = details
        .map((c) => ({
          id: c.id,
          name: c.fullName ?? "",
          phone: c.phones?.[0]?.number ?? "",
          email: c.emails?.[0]?.address,
        }))
        .filter((c) => Boolean(c.name && c.phone));
      if (!stop) {
        setContacts(mapped);
        setStatus("ready");
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function importSelected() {
    setStatus("importing");
    setError(null);
    try {
      const picked = contacts.filter((c) => selected.has(c.id));
      const data = await api<{ imported: number; updated: number; skipped: number }>(
        "/api/customers/import-contacts",
        {
          method: "POST",
          body: JSON.stringify({
            contacts: picked.map((c) => ({ name: c.name, phone: c.phone, email: c.email })),
            confirmOwn: true,
          }),
        },
      );
      setResult(`${data.imported} imported, ${data.updated} updated, ${data.skipped} skipped.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import failed.");
      setStatus("ready");
    }
  }

  if (status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-panel">
        <ActivityIndicator color="#5FA3F0" />
      </View>
    );
  }

  if (status === "denied") {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
        <Text className="text-center font-sans text-sm text-ink">
          TradeSura needs permission to read your contacts to import them. Enable it in your
          device Settings and try again.
        </Text>
        <Button variant="ghost" onPress={() => router.back()}>
          Back
        </Button>
      </View>
    );
  }

  if (result) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-panel px-6">
        <Text className="text-center font-semibold text-sm text-ink">{result}</Text>
        <Button onPress={() => router.back()}>Done</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-paper">
        <AppHeader title="Import contacts" />
      </SafeAreaView>
      <FlatList
        data={contacts}
        keyExtractor={(c) => c.id}
        contentContainerClassName="gap-1 p-4 pb-28"
        ListHeaderComponent={
          <View className="mb-2 flex-row items-center justify-between">
            <Pressable onPress={() => router.back()}>
              <Text className="font-semibold text-sm text-flame-deep">‹ Back</Text>
            </Pressable>
            <Text className="font-sans text-xs text-muted">
              {selected.size} of {contacts.length} selected
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => toggle(item.id)}
            className={`flex-row items-center justify-between rounded-[10px] border px-3 py-2.5 ${
              selected.has(item.id) ? "border-flame bg-flame-tint" : "border-line bg-paper"
            }`}
          >
            <Text className="font-sans text-sm text-ink">{item.name}</Text>
            <Text className="font-mono text-xs text-muted">{item.phone}</Text>
          </Pressable>
        )}
      />
      {error && <Text className="px-4 pb-2 font-sans text-sm text-danger">{error}</Text>}
      <View className="absolute bottom-0 left-0 right-0 gap-2.5 border-t border-line bg-paper p-4">
        <Pressable
          onPress={() => setConfirmed((v) => !v)}
          className="flex-row items-start gap-2.5"
        >
          <View
            className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${confirmed ? "border-flame bg-flame" : "border-line"}`}
          >
            {confirmed && <Text className="text-[11px] text-white">✓</Text>}
          </View>
          <Text className="flex-1 font-sans text-[13px] text-muted">
            These are my own customers — people I&apos;ve done work for or who&apos;ve asked me
            to.
          </Text>
        </Pressable>
        <Button
          onPress={importSelected}
          disabled={selected.size === 0 || !confirmed || status === "importing"}
        >
          {status === "importing"
            ? "Importing…"
            : `Import ${selected.size} contact${selected.size === 1 ? "" : "s"}`}
        </Button>
      </View>
    </View>
  );
}
