import { useCallback, useState } from "react";
import { View, Text, ScrollView, TextInput, Pressable, ActivityIndicator } from "react-native";
import { router, useFocusEffect, Link } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { AppHeader, Card, Micro, Button } from "@/components/ui";

type Customer = { id: string; firstName: string; lastName: string; phone: string };

const inputCls = "rounded-[10px] border border-line bg-paper px-3 py-2 font-sans text-sm text-ink";

export default function OfferStart() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [tierCount, setTierCount] = useState<number | null>(null);
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
      const data = await api<{ customers: Customer[]; tierCount: number }>("/api/offer");
      setCustomers(data.customers);
      setTierCount(data.tierCount);
      setMode(data.customers.length ? "existing" : "new");
      setCustomerId(data.customers[0]?.id ?? null);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Couldn't load your book.");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "existing" ? { customerId } : { ...form, email: form.email || undefined };
      const data = await api<{ planId: string }>("/api/offer", {
        method: "POST",
        body: JSON.stringify(body),
      });
      router.push(`/offer/${data.planId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the link.");
    } finally {
      setBusy(false);
    }
  }

  const canSend =
    mode === "existing" ? Boolean(customerId) : Boolean(form.firstName && form.lastName && form.phone);
  const shown = customers ? (showAll ? customers : customers.slice(0, 8)) : [];

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader right={<Micro className="text-[#AEB9C4]">Offer a plan</Micro>} />
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
          <ActivityIndicator color="#0E7FD0" />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-3.5 px-4 pb-8 pt-4">
          <Card className="items-center py-5">
            <Micro>Average signup time</Micro>
            <Text className="mt-1 font-mono-semibold text-4xl text-flame-deep">0:84</Text>
            <Text className="mt-1 font-sans text-xs text-muted">
              Offer it while the boiler&apos;s still warm.
            </Text>
          </Card>

          {tierCount === 0 ? (
            <Card>
              <Text className="font-sans text-sm text-ink">
                You need at least one plan tier first —{" "}
                <Link href="/(tabs)/plans" className="font-sans-semibold text-flame-deep">
                  build your plan
                </Link>
                .
              </Text>
            </Card>
          ) : (
            <Card>
              <Text className="mb-2 font-sans-semibold text-sm text-ink">Send signup link</Text>

              {customers.length > 0 && (
                <View className="mb-3 flex-row gap-2">
                  <Pressable
                    onPress={() => setMode("existing")}
                    className={`rounded-full px-3 py-1.5 ${mode === "existing" ? "bg-flame-tint" : "border border-line bg-panel"}`}
                  >
                    <Text
                      className={`font-mono-medium text-xs ${mode === "existing" ? "text-flame-deep" : "text-faint"}`}
                    >
                      From my book
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setMode("new")}
                    className={`rounded-full px-3 py-1.5 ${mode === "new" ? "bg-flame-tint" : "border border-line bg-panel"}`}
                  >
                    <Text
                      className={`font-mono-medium text-xs ${mode === "new" ? "text-flame-deep" : "text-faint"}`}
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
                        <Text className={`font-sans-bold ${customerId === c.id ? "text-flame" : "text-line"}`}>
                          {customerId === c.id ? "●" : "○"}
                        </Text>
                      </Pressable>
                    ))}
                    {!showAll && customers.length > 8 && (
                      <Pressable onPress={() => setShowAll(true)} className="pt-2.5">
                        <Text className="text-center font-sans-semibold text-sm text-flame-deep">
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
                </View>
              )}

              {error && <Text className="mt-2 font-sans text-sm text-danger">{error}</Text>}
              <Button onPress={send} disabled={busy || !canSend} className="mt-3">
                {busy ? "Sending…" : "Text the link now"}
              </Button>
              <Micro className="mt-2 text-center">A QR code is on the next screen too</Micro>
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}
