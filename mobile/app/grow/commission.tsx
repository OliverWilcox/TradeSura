import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatPounds } from "@/lib/earnings";
import { AppHeader, Card, Button, Micro } from "@/components/ui";

// Matt, 6 Nov — staff commission, owners only. The owner sets a reward for
// each plan their staff sell, per sign-up or a month while it's live, and
// sees who sold what. We work it out; the owner pays it.

type Rule = { type: "signup" | "monthly"; pence: number };
type Row = { id: string; name: string; removed: boolean; offers: number; signedUp: number; live: number; thisMonthPence: number; toDatePence: number };

const TYPES: { key: Rule["type"]; label: string; hint: string }[] = [
  { key: "signup", label: "Per sign-up", hint: "Once, when the customer joins" },
  { key: "monthly", label: "Each month it's live", hint: "Every month the plan stays on" },
];

export default function CommissionScreen() {
  const { refreshMe } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [type, setType] = useState<Rule["type"]>("signup");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    api<{ rule: Rule | null; staff: Row[] }>("/api/grow/commission")
      .then((d) => {
        setRows(d.staff);
        if (d.rule) {
          setType(d.rule.type);
          setAmount((d.rule.pence / 100).toFixed(2).replace(/\.00$/, ""));
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your team."));
  }, []);
  useFocusEffect(load);

  async function save() {
    const pence = Math.round(Number(amount) * 100);
    if (!Number.isFinite(pence) || pence < 1) return setError("Enter an amount, like 5 or 1.50.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/grow/commission", { method: "PUT", body: JSON.stringify({ type, pence }) });
      setSaved(true);
      load();
      await refreshMe();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Staff commission" />
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-3.5 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
          <Card>
            <Text className="text-[15px] font-semibold text-ink">Reward your team for the plans they sell</Text>
            <Text className="mt-0.5 text-[12.5px] leading-[18px] text-muted">
              We keep track of who sold what. You pay your team yourself; nothing comes out of your payouts.
            </Text>
            <View className="mt-3 gap-2">
              {TYPES.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    setType(t.key);
                    setSaved(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: type === t.key }}
                  className={`rounded-xl border-[1.5px] px-3.5 py-3 ${type === t.key ? "border-flame bg-flame/10" : "border-white/20"}`}
                >
                  <Text className="text-[15px] font-semibold text-ink">{t.label}</Text>
                  <Text className="text-[12.5px] text-muted">{t.hint}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="mt-3 text-[13px] font-semibold text-ink">Amount (£)</Text>
            <TextInput
              value={amount}
              onChangeText={(v) => {
                setAmount(v.replace(/[^0-9.]/g, ""));
                setError(null);
                setSaved(false);
              }}
              placeholder={type === "signup" ? "5" : "1"}
              placeholderTextColor="#6e86a3"
              keyboardType="decimal-pad"
              maxLength={7}
              accessibilityLabel="Commission amount in pounds"
              className={`mt-1.5 min-h-[52px] rounded-xl border-[1.5px] bg-[#081321] px-4 text-[17px] text-white ${error ? "border-danger" : "border-white/20"}`}
            />
            {error && <Text className="mt-1.5 text-[13px] text-danger">{error}</Text>}
            <Button className="mt-3" onPress={save} disabled={busy}>
              {busy ? "Saving…" : saved ? "Saved" : "Save"}
            </Button>
          </Card>

          <Micro>Who sold what</Micro>
          {rows?.length === 0 && (
            <Card>
              <Text className="text-[14px] text-muted">Add a team member to start tracking their sales.</Text>
            </Card>
          )}
          {rows?.map((r) => (
            <Card key={r.id}>
              <View className="flex-row items-center justify-between">
                <Text className="text-[15px] font-semibold text-ink">
                  {r.name}
                  {r.removed ? " (left)" : ""}
                </Text>
                <Text className="text-[15px] font-semibold text-ok">{formatPounds(r.thisMonthPence)}</Text>
              </View>
              <Text className="mt-0.5 text-[12.5px] text-muted">
                {r.signedUp} signed up · {r.live} live · {r.offers} offered
              </Text>
              <Text className="mt-0.5 text-[12.5px] text-muted">
                This month, and <Text className="text-ok">{formatPounds(r.toDatePence)}</Text> to date
              </Text>
            </Card>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
