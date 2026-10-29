import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, AppState, Linking } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Contacts from "expo-contacts";
import * as DocumentPicker from "expo-document-picker";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Button, Card, ScreenTitle, SectionHeading } from "@/components/ui";
import { Icon, type IconName } from "@/components/icon";
import { CenteredSpinner } from "@/components/skeleton";
import { useSetupExit } from "@/lib/setup-exit";

type PickedContact = { id: string; name: string; phone: string; email?: string };
type ImportResult = { imported: number; updated: number; skipped: number; from: "contacts" | "csv" };
type Status = "intro" | "loading" | "denied" | "ready" | "importing";

// Screen 05 — phone-book import. expo-contacts' native picker
// (Contact.presentPicker()) only returns one contact at a time, so bulk
// import reads the address book and lets the engineer multi-select in-app —
// strictly better than the web version's Chrome-on-Android-only picker.
// Review 4 — "Bring in your customers" opens on a choice (contacts,
// spreadsheet, one at a time) rather than straight into iOS's permission
// prompt; arriving from Customers' "Import from contacts" skips it.
export default function ImportContacts() {
  const { consent } = useLocalSearchParams<{ consent?: string }>();
  const [status, setStatus] = useState<Status>(consent === "1" ? "loading" : "intro");
  const [contacts, setContacts] = useState<PickedContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Ticked already when arriving from Customers, where the same box gates
  // the button; still shown here so it can be unticked.
  const [confirmed, setConfirmed] = useState(consent === "1");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  // Review 4 — during setup every way out goes back to the hub.
  const { exit, inSetup } = useSetupExit();
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const readContacts = useCallback(async (ask: boolean) => {
    try {
      const perm = ask ? await Contacts.requestPermissionsAsync() : await Contacts.getPermissionsAsync();
      if (perm.status !== "granted") {
        setStatus("denied");
        return;
      }
      setStatus("loading");
      const details = await Contacts.Contact.getAllDetails(
        [Contacts.ContactField.FULL_NAME, Contacts.ContactField.PHONES, Contacts.ContactField.EMAILS],
        { limit: 1000 },
      );
      setContacts(
        details
          .map((c) => ({
            id: c.id,
            name: c.fullName ?? "",
            phone: c.phones?.[0]?.number ?? "",
            email: c.emails?.[0]?.address,
          }))
          .filter((c) => Boolean(c.name && c.phone)),
      );
      setStatus("ready");
    } catch {
      // No contacts module (web) or the read failed: treat like a refusal,
      // which offers the other routes.
      setStatus("denied");
    }
  }, []);

  // Arriving from Customers' "Import from contacts": straight to the list.
  useEffect(() => {
    if (consent !== "1") return;
    (async () => {
      await readContacts(true);
    })();
  }, [consent, readContacts]);

  // Review 4 — the engineer may switch it on in Settings and come back:
  // check again whenever the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && statusRef.current === "denied") readContacts(false);
    });
    return () => sub.remove();
  }, [readContacts]);

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
      setResult({ ...data, from: "contacts" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import failed.");
      setStatus("ready");
    }
  }

  async function pickCsv() {
    setError(null);
    const picked = await DocumentPicker.getDocumentAsync({ type: "*/*" });
    if (picked.canceled || !picked.assets[0]) return;
    const file = picked.assets[0];
    setCsvBusy(true);
    try {
      const form = new FormData();
      // Native wants { uri, name, type }; on web the picker hands us a real File.
      form.append("file", file.file ?? ({ uri: file.uri, name: file.name, type: file.mimeType ?? "text/csv" } as unknown as Blob));
      // Part 10 — the own-customers PECR box, required server-side too.
      form.append("confirmOwn", "1");
      const data = await api<{ imported: number; updated: number; skipped: number }>("/api/customers/import", {
        method: "POST",
        body: form,
      });
      setResult({ ...data, from: "csv" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Import failed.");
    } finally {
      setCsvBusy(false);
    }
  }

  const header = (title: string, onBack: () => void = () => exit()) => (
    <SafeAreaView edges={["top"]} className="bg-paper">
      <AppHeader title={title} onBack={onBack} />
    </SafeAreaView>
  );

  if (result) return <ImportDone result={result} inSetup={inSetup} onMore={() => { setResult(null); setSelected(new Set()); setStatus("intro"); }} />;

  if (status === "intro") {
    return (
      <View className="flex-1 bg-panel">
        {header("Bring in your customers")}
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
          <ScreenTitle
            title="Bring in your customers"
            intro="Add the people you already look after, so you can offer them a plan."
          />
          <Card className="gap-1.5">
            <Reassure icon="check" text="Only the people you choose come in." />
            <Reassure icon="lock" text="Nobody is texted or emailed unless you send them an offer." />
            <Reassure icon="shield" text="Your contacts stay on your phone. We only keep the ones you add." />
          </Card>
          <Pressable onPress={() => setConfirmed((v) => !v)} className="flex-row items-start gap-2.5">
            <View
              className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${confirmed ? "border-flame bg-flame" : "border-line"}`}
            >
              {confirmed && <Text className="text-[11px] text-white">✓</Text>}
            </View>
            <Text className="flex-1 font-sans text-[13px] text-muted">
              These are my own customers — people I&apos;ve done work for or who&apos;ve asked me to.
            </Text>
          </Pressable>
          <SectionHeading>How would you like to add them?</SectionHeading>
          <Route
            icon="person"
            title="From my contacts"
            sub="Tick the customers in your phone's address book."
            disabled={!confirmed}
            onPress={() => readContacts(true)}
          />
          <Route
            icon="document"
            title={csvBusy ? "Importing…" : "From a spreadsheet"}
            sub="A CSV file with first_name, last_name and phone columns (email, postcode optional)."
            disabled={!confirmed || csvBusy}
            onPress={pickCsv}
          />
          <Route
            icon="addCustomer"
            title="One at a time"
            sub="Type in a name and mobile."
            onPress={() => router.push("/add-customer")}
          />
          {!confirmed && (
            <Text className="font-sans text-xs text-warn">Tick the box above to import from contacts or a spreadsheet.</Text>
          )}
          {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
        </ScrollView>
      </View>
    );
  }

  if (status === "loading") {
    return (
      <View className="flex-1 bg-panel">
        <CenteredSpinner label="Reading your contacts" />
      </View>
    );
  }

  if (status === "denied") {
    return (
      <View className="flex-1 bg-panel">
        {header("Your contacts")}
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
          <View className="h-14 w-14 items-center justify-center rounded-full bg-warn-tint">
            <Icon name="person" size={26} color="#F2B84B" />
          </View>
          <ScreenTitle
            title="Allow access to your contacts"
            intro="TradeSura can't see your contacts yet. Switch on Contacts for TradeSura in your iPhone's Settings, then come back here — we'll pick it up straight away."
          />
          <Card className="gap-1.5">
            <Reassure icon="check" text="You still choose who comes in, one tick at a time." />
            <Reassure icon="lock" text="Nobody is contacted unless you send them an offer." />
          </Card>
          <Button onPress={() => Linking.openSettings().catch(() => {})}>Open Settings</Button>
          <Button variant="ghost" onPress={() => setStatus("intro")}>
            Add customers another way
          </Button>
          <Pressable onPress={() => exit()} className="items-center py-1">
            <Text className="text-sm font-semibold text-muted">{inSetup ? "Back to setup" : "Back"}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-panel">
      {header("Import contacts", () => (consent === "1" ? exit() : setStatus("intro")))}
      <FlatList
        data={contacts}
        keyExtractor={(c) => c.id}
        contentContainerClassName="gap-1 p-4 pb-28"
        ListHeaderComponent={
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="font-sans text-xs text-muted">Tick the customers to add.</Text>
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
            <Text className="tabular-nums text-xs text-muted">{item.phone}</Text>
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

function Reassure({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <Icon name={icon} size={16} color="#9fb6d0" />
      <Text className="flex-1 text-[13px] text-ink">{text}</Text>
    </View>
  );
}

function Route({
  icon,
  title,
  sub,
  onPress,
  disabled,
}: {
  icon: IconName;
  title: string;
  sub: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      className={`flex-row items-center gap-3 rounded-2xl border border-line bg-paper p-4 ${disabled ? "opacity-50" : ""}`}
    >
      <View className="h-10 w-10 items-center justify-center rounded-full bg-paper-3">
        <Icon name={icon} size={20} color="#5FA3F0" />
      </View>
      <View className="flex-1">
        <Text className="text-[15px] font-bold text-ink">{title}</Text>
        <Text className="text-[13px] text-muted">{sub}</Text>
      </View>
      <Icon name="chevron" size={13} color="#9fb6d0" />
    </Pressable>
  );
}

// Review 4 — the import result was a bare line of text. Now a designed
// screen: what came in, what happens next, and the way back.
function ImportDone({ result, inSetup, onMore }: { result: ImportResult; inSetup: boolean; onMore: () => void }) {
  const { imported, updated, skipped } = result;
  const added = imported + updated;
  const title =
    imported > 0
      ? `${imported} customer${imported === 1 ? "" : "s"} added`
      : updated > 0
        ? "Your book is up to date"
        : "Nobody new to add";
  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-paper">
        <AppHeader title="Import done" onBack={() => (inSetup ? router.navigate("/onboarding") : router.back())} />
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-flame-tint">
          <Icon name="check" size={26} color="#5FA3F0" />
        </View>
        <ScreenTitle
          title={title}
          intro={result.from === "csv" ? "From your spreadsheet." : "From your contacts."}
        />
        <Card className="gap-2">
          <ResultRow label="New customers" n={imported} />
          <ResultRow label="Already in your book, updated" n={updated} />
          <ResultRow label="Skipped (no valid UK mobile, or a duplicate)" n={skipped} />
        </Card>
        <Card className="gap-1.5">
          <SectionHeading className="mb-1">What happens next</SectionHeading>
          <Text className="text-[14px] leading-[20px] text-ink">
            {added > 0
              ? "They're in Customers. Nobody has been contacted — offer each one a plan when you're ready, at the end of a job or with a text from you."
              : "Nothing has changed in Customers, and nobody has been contacted."}
          </Text>
        </Card>
        {inSetup ? (
          <Button onPress={() => router.navigate("/onboarding")}>Back to setup</Button>
        ) : (
          <Button onPress={() => router.replace("/(tabs)/(customers)/customers")}>See my customers</Button>
        )}
        <Button variant="ghost" onPress={onMore}>
          Add more customers
        </Button>
      </ScrollView>
    </View>
  );
}

function ResultRow({ label, n }: { label: string; n: number }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="flex-1 text-[14px] text-ink">{label}</Text>
      <Text className="tabular-nums text-[15px] font-bold text-ink">{n}</Text>
    </View>
  );
}
