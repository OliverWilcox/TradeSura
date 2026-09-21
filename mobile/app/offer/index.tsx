import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Linking,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams, Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

type Customer = { id: string; firstName: string; lastName: string; phone: string };
type Tier = { id: string; name: string; priceMonthlyPence: number; lines: string[] };

const SCRIPT =
  "“I put all my customers on a care plan now — £12 a month and your annual service is included. I’ll text you the link, have a look tonight.”";

const inputCls = "rounded-[10px] border border-line bg-paper px-3 py-2 font-sans text-sm text-ink";

export default function OfferStart() {
  const { me } = useAuth();
  const { customerId: customerIdParam } = useLocalSearchParams<{ customerId?: string }>();
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [tierCount, setTierCount] = useState<number | null>(null);
  const [tierId, setTierId] = useState<string | null>(null);
  const [scriptOpen, setScriptOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    addressLine1: "",
    town: "",
    postcode: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{
        customers: Customer[];
        tierCount: number;
        offersSent: number;
        tiers: Tier[];
      }>("/api/offer");
      setCustomers(data.customers);
      setTierCount(data.tierCount);
      setTiers(data.tiers);
      setTierId((current) => current ?? data.tiers[0]?.id ?? null);
      setScriptOpen(data.offersSent < 10);
      const preselect =
        customerIdParam && data.customers.some((c) => c.id === customerIdParam)
          ? customerIdParam
          : data.customers[0]?.id ?? null;
      setMode(preselect ? "existing" : data.customers.length ? "existing" : "new");
      setCustomerId(preselect);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load your book.");
    }
  }, [customerIdParam]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function send(channel: "sms" | "whatsapp") {
    if (!tierId) return;
    setBusy(true);
    setError(null);
    try {
      const base =
        mode === "existing" ? { customerId } : { ...form, email: form.email || undefined };
      const data = await api<{ planId: string; link: string; message: string; customerFirstName: string }>(
        "/api/offer",
        { method: "POST", body: JSON.stringify({ ...base, tierId, channel }) },
      );
      if (channel === "whatsapp") {
        const wa = `whatsapp://send?text=${encodeURIComponent(data.message)}`;
        const ok = await Linking.canOpenURL(wa);
        await Linking.openURL(ok ? wa : `https://wa.me/?text=${encodeURIComponent(data.message)}`);
      }
      router.push(`/offer/${data.planId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  }

  const previewName =
    mode === "existing"
      ? customers?.find((c) => c.id === customerId)?.firstName ?? "there"
      : form.firstName || "there";
  const brandLabel = me?.tradingName ?? "your engineer";
  const linkPreview = me?.slug ? `tradesura.com/p/${me.slug}` : "your plan link";
  const selectedTier = tiers?.find((t) => t.id === tierId) ?? null;

  const canSend =
    Boolean(tierId) &&
    (mode === "existing" ? Boolean(customerId) : Boolean(form.firstName && form.lastName && form.phone));
  const shown = customers ? (showAll ? customers : customers.slice(0, 8)) : [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Offer a plan" />
      </SafeAreaView>

      {loadError ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="font-sans text-sm text-danger">{loadError}</Text>
          <Button onPress={load} variant="ghost" className="w-full">
            Try again
          </Button>
        </View>
      ) : customers === null || tierCount === null ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#5FA3F0" />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
          {tierCount > 0 && (
            <Card className="border-warn-tint bg-warn-tint">
              <Pressable
                onPress={() => setScriptOpen((v) => !v)}
                className="flex-row items-center justify-between"
              >
                <Micro className="text-warn">What to say</Micro>
                <Text className="font-sans text-xs text-warn">{scriptOpen ? "Hide" : "Show"}</Text>
              </Pressable>
              {scriptOpen && (
                <Text className="mt-1.5 font-sans text-[13px] text-ink">{SCRIPT}</Text>
              )}
            </Card>
          )}

          {tierCount === 0 ? (
            <Card>
              <Text className="font-sans text-sm text-ink">
                You need a plan first ·{" "}
                <Link href="/plans" className="font-semibold text-flame-deep">
                  Build my plan →
                </Link>
              </Text>
            </Card>
          ) : !me?.gasSafeVerifiedAt ? (
            // Build Guide v2 Part 6.5 LAW — the two-leg gate: sending an
            // offer needs a live plan AND the badge, not plan-only.
            <Card>
              <Text className="font-sans text-sm text-ink">
                You need your Gas Safe badge first ·{" "}
                <Link href="/more" className="font-semibold text-flame-deep">
                  Check your status →
                </Link>
              </Text>
            </Card>
          ) : (
            <Card>
              <Text className="mb-2 font-semibold text-sm text-ink">Send signup link</Text>

              {/* Build Guide v2 Part 9.2 — "Pick the customer, pick the
                  plan, see the exact text, send." */}
              {tiers && tiers.length > 1 && (
                <View className="mb-3 flex-row flex-wrap gap-1.5">
                  {tiers.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => setTierId(t.id)}
                      className={`rounded-full px-3 py-1.5 ${tierId === t.id ? "bg-flame-tint" : "border border-line bg-panel"}`}
                    >
                      <Text
                        className={`font-mono font-medium text-xs ${tierId === t.id ? "text-flame-deep" : "text-faint"}`}
                      >
                        {t.name} · £{(t.priceMonthlyPence / 100).toFixed(0)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {customers.length > 0 && (
                <View className="mb-3 flex-row gap-2">
                  <Pressable
                    onPress={() => setMode("existing")}
                    className={`rounded-full px-3 py-1.5 ${mode === "existing" ? "bg-flame-tint" : "border border-line bg-panel"}`}
                  >
                    <Text
                      className={`font-mono font-medium text-xs ${mode === "existing" ? "text-flame-deep" : "text-faint"}`}
                    >
                      From my book
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMode("new")}
                    className={`rounded-full px-3 py-1.5 ${mode === "new" ? "bg-flame-tint" : "border border-line bg-panel"}`}
                  >
                    <Text
                      className={`font-mono font-medium text-xs ${mode === "new" ? "text-flame-deep" : "text-faint"}`}
                    >
                      New customer
                    </Text>
                  </Pressable>
                </View>
              )}

              {mode === "existing" ? (
                customers.length === 0 ? (
                  <Text className="font-sans text-sm text-muted">
                    No customers in your book yet — switch to &ldquo;New customer&rdquo; above.
                  </Text>
                ) : (
                  <View>
                    {shown.map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => setCustomerId(c.id)}
                        className="flex-row items-center justify-between gap-2 border-b border-line-soft py-2.5 last:border-b-0"
                      >
                        <Text className="font-sans text-sm text-ink">
                          {c.firstName} {c.lastName} · {c.phone}
                        </Text>
                        <Text className={`font-bold ${customerId === c.id ? "text-flame" : "text-line"}`}>
                          {customerId === c.id ? "●" : "○"}
                        </Text>
                      </Pressable>
                    ))}
                    {!showAll && customers.length > 8 && (
                      <Pressable onPress={() => setShowAll(true)} className="pt-2.5">
                        <Text className="text-center font-semibold text-sm text-flame-deep">
                          View all {customers.length} customers →
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )
              ) : (
                <View className="gap-2">
                  <View className="flex-row gap-2">
                    <TextInput
                      placeholder="First name"
                      value={form.firstName}
                      onChangeText={(v) => setForm({ ...form, firstName: v })}
                      className={`flex-1 ${inputCls}`}
                    />
                    <TextInput
                      placeholder="Last name"
                      value={form.lastName}
                      onChangeText={(v) => setForm({ ...form, lastName: v })}
                      className={`flex-1 ${inputCls}`}
                    />
                  </View>
                  <TextInput
                    placeholder="Mobile (07…)"
                    keyboardType="phone-pad"
                    value={form.phone}
                    onChangeText={(v) => setForm({ ...form, phone: v })}
                    className={inputCls}
                  />
                  <TextInput
                    placeholder="Email (for the plan document)"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={form.email}
                    onChangeText={(v) => setForm({ ...form, email: v })}
                    className={inputCls}
                  />
                  <View className="flex-row gap-2">
                    <TextInput
                      placeholder="Address line 1"
                      value={form.addressLine1}
                      onChangeText={(v) => setForm({ ...form, addressLine1: v })}
                      className={`flex-1 ${inputCls}`}
                    />
                    <TextInput
                      placeholder="Postcode"
                      value={form.postcode}
                      onChangeText={(v) => setForm({ ...form, postcode: v })}
                      className={`w-28 ${inputCls}`}
                    />
                  </View>
                  <Pressable onPress={() => router.push("/plans")} className="pt-1">
                    <Text className="font-semibold text-xs text-flame-deep">Manage my plans →</Text>
                  </Pressable>
                </View>
              )}

              {/* Part 18 — the offer text template, verbatim: "Hi {first
                  name} — {engineer first name} from {trading name}. My
                  {plan name} plan is £{X} a month: {benefits, lower case,
                  comma-run}. Sign up here — takes a minute: {personal
                  link}" — server sends this exact text; this previews it. */}
              <Micro className="mb-1.5 mt-3">Their message</Micro>
              <View className="rounded-[14px] rounded-bl-[4px] bg-flame-tint p-3">
                <Text className="font-sans text-[12.5px] text-ink">
                  Hi {previewName} — {me?.firstName ?? brandLabel} from {brandLabel}. My{" "}
                  {selectedTier?.name ?? "plan"} plan is £
                  {selectedTier ? (selectedTier.priceMonthlyPence / 100).toFixed(2).replace(/\.00$/, "") : "—"}{" "}
                  a month: {selectedTier?.lines.map((l) => l.toLowerCase()).join(", ") ?? ""}. Sign up
                  here — takes a minute:{" "}
                  <Text className="font-semibold text-flame-deep">{linkPreview}</Text>
                </Text>
              </View>

              {error && <Text className="mt-2 font-sans text-sm text-danger">{error}</Text>}
              <View className="mt-3 flex-row gap-2">
                <Button
                  onPress={() => send("sms")}
                  disabled={busy || !canSend}
                  className="flex-1"
                >
                  {busy ? "Sending…" : "Send by text"}
                </Button>
                <Button
                  onPress={() => send("whatsapp")}
                  disabled={busy || !canSend}
                  className="flex-1"
                >
                  WhatsApp
                </Button>
              </View>
              <Micro className="mt-2 text-center">
                We&apos;ll nudge {previewName} if they haven&apos;t looked in 3 days.
              </Micro>
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}
