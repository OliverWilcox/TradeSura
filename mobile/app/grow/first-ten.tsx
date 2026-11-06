import { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatPounds } from "@/lib/earnings";
import { AppHeader, Card, Button, Micro } from "@/components/ui";
import { Icon } from "@/components/icon";

// Matt, 6 Nov — Pick your first 10: the customers most likely to join
// (regulars, recent installs, landlords) from the book, then one tap sends
// each their own plan offer. Each goes through POST /api/offer, so it comes
// from TradeSura, waits for 8am at night, and gets the 2- and 7-day
// follow-ups like any other offer.

type Candidate = { id: string; firstName: string; lastName: string; phone: string; hints: ("landlord" | "recent" | "regular")[]; offered: boolean };
type Tier = { id: string; name: string; priceMonthlyPence: number };
type Result = { id: string; name: string; outcome: "sent" | "queued" | "not_sent" | "failed"; error?: string };

const HINT: Record<Candidate["hints"][number], string> = { landlord: "Landlord", recent: "Recent work", regular: "Regular" };
const OUTCOME: Record<Result["outcome"], string> = {
  sent: "Sent",
  queued: "Goes at 8am",
  not_sent: "Text didn't go",
  failed: "Not sent",
};

export default function FirstTenScreen() {
  const { refreshMe } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [sentBefore, setSentBefore] = useState(0);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [tierId, setTierId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      Promise.all([
        api<{ sent: number; candidates: Candidate[] }>("/api/grow/first-ten"),
        api<{ tiers: Tier[] }>("/api/offer"),
      ])
        .then(([c, o]) => {
          setCandidates(c.candidates);
          setSentBefore(c.sent);
          setTiers(o.tiers);
          setTierId((id) => id ?? o.tiers[0]?.id ?? null);
        })
        .catch(() => setError("Couldn't load your customers."));
    }, []),
  );

  const room = Math.max(0, 10 - sentBefore);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (candidates ?? []).filter((c) => !c.offered && (!q || `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)));
  }, [candidates, query]);

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < room ? [...p, id] : p));
  }

  async function send() {
    if (!tierId || picked.length === 0) return;
    setBusy(true);
    setError(null);
    const out: Result[] = [];
    // One at a time, so each customer's result is clear.
    for (const id of picked) {
      const c = candidates?.find((x) => x.id === id);
      const name = c ? `${c.firstName} ${c.lastName}` : "Customer";
      try {
        const res = await api<{ text: "sent" | "queued" | "not_sent" | null }>("/api/offer", {
          method: "POST",
          body: JSON.stringify({ customerId: id, tierId, channel: "sms", source: "first10" }),
        });
        out.push({ id, name, outcome: res.text === "queued" ? "queued" : res.text === "not_sent" ? "not_sent" : "sent" });
      } catch (e) {
        out.push({ id, name, outcome: "failed", error: e instanceof ApiError ? e.message : undefined });
      }
      setResults([...out]);
    }
    setPicked([]);
    setBusy(false);
    await refreshMe();
  }

  const tier = tiers.find((t) => t.id === tierId);

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Pick your first 10" />
      </SafeAreaView>
      <ScrollView contentContainerClassName="gap-3.5 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
        <Card>
          <Text className="text-[22px] font-extrabold text-ink">{Math.min(10, sentBefore + (results?.filter((r) => r.outcome !== "failed").length ?? 0))}/10 offered</Text>
          <Text className="mt-1 text-[13px] leading-[19px] text-muted">
            Pick the customers most likely to join: regulars, recent installs, landlords. Each gets their own text from TradeSura with your plan and a personal link.
          </Text>
        </Card>

        {results && (
          <Card>
            <Micro>Sent</Micro>
            {results.map((r) => (
              <View key={r.id} className="mt-2 flex-row items-center justify-between">
                <Text className="text-[14px] text-ink">{r.name}</Text>
                <Text className={`text-[13px] font-semibold ${r.outcome === "sent" || r.outcome === "queued" ? "text-ink" : "text-danger"}`}>
                  {r.error ?? OUTCOME[r.outcome]}
                </Text>
              </View>
            ))}
            {!busy && (
              <Button className="mt-3" variant="ghost" onPress={() => router.back()}>
                Done
              </Button>
            )}
          </Card>
        )}

        {tiers.length > 1 && (
          <View className="flex-row flex-wrap gap-2">
            {tiers.map((t) => (
              <Pressable
                key={t.id}
                onPress={() => setTierId(t.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: t.id === tierId }}
                className={`rounded-full border-[1.5px] px-3.5 py-2 ${t.id === tierId ? "border-flame bg-flame/10" : "border-white/20"}`}
              >
                <Text className="text-[13.5px] font-semibold text-ink">
                  {t.name} · <Text className="text-ok">{formatPounds(t.priceMonthlyPence)}</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {room === 0 ? (
          <Card>
            <Text className="text-[14px] text-ink">You&apos;ve offered your first 10. Keep going from Customers or Offer a plan.</Text>
          </Card>
        ) : (
          <>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your customers"
              placeholderTextColor="#6e86a3"
              accessibilityLabel="Search your customers"
              className="min-h-[48px] rounded-xl border-[1.5px] border-white/20 bg-[#081321] px-4 text-[16px] text-white"
            />
            {error && <Text className="text-[13px] text-danger">{error}</Text>}
            {candidates && shown.length === 0 && (
              <Card>
                <Text className="text-[14px] text-muted">
                  {candidates.length === 0 ? "Bring in your customers first, then pick your 10 here." : "No one matches that search."}
                </Text>
              </Card>
            )}
            {shown.map((c) => {
              const on = picked.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggle(c.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  className={`flex-row items-center gap-3 rounded-2xl border px-3.5 py-3 ${on ? "border-flame bg-flame/10" : "border-line-strong"}`}
                >
                  <View className={`h-6 w-6 items-center justify-center rounded-full border-[1.5px] ${on ? "border-white bg-white" : "border-white/40"}`}>
                    {on && <Icon name="check" size={13} color="#0b1a2e" weight="bold" />}
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-semibold text-ink">
                      {c.firstName} {c.lastName}
                    </Text>
                    {c.hints.length > 0 && <Text className="text-[12.5px] text-muted">{c.hints.map((h) => HINT[h]).join(" · ")}</Text>}
                  </View>
                </Pressable>
              );
            })}
          </>
        )}

        {picked.length > 0 && (
          <Button onPress={send} disabled={busy || !tier}>
            {busy ? "Sending…" : `Send ${picked.length} offer${picked.length === 1 ? "" : "s"}${tier ? ` · ${tier.name}` : ""}`}
          </Button>
        )}
      </ScrollView>
    </View>
  );
}
