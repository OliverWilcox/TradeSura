import { useCallback, useState } from "react";
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatPounds } from "@/lib/earnings";
import { AppHeader, Card, Button, Micro } from "@/components/ui";

// Matt, 6 Nov — First month goal (we launch in January, so not "Christmas"):
// the engineer sets how many plans they'll sign this month and sees what
// it's worth each month, a progress bar, and a nudge if they're behind.

type Goal = { target: number | null; signed: number; worthPence: number; pace: number; behind: boolean };

export default function GoalScreen() {
  const { refreshMe } = useAuth();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api<Goal>("/api/grow/goal")
        .then((g) => {
          setGoal(g);
          setEditing(g.target === null);
          setValue(g.target ? String(g.target) : "");
        })
        .catch(() => setError("Couldn't load your goal."));
    }, []),
  );

  async function save() {
    const target = Number(value);
    if (!Number.isInteger(target) || target < 1 || target > 500) return setError("Enter how many plans, from 1 to 500.");
    setBusy(true);
    setError(null);
    try {
      setGoal(await api<Goal>("/api/grow/goal", { method: "PUT", body: JSON.stringify({ target }) }));
      setEditing(false);
      await refreshMe();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your goal.");
    } finally {
      setBusy(false);
    }
  }

  const target = goal?.target ?? 0;
  const progress = target ? Math.min(1, (goal?.signed ?? 0) / target) : 0;
  const met = Boolean(target) && (goal?.signed ?? 0) >= target;

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="First month goal" />
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-3.5 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
          {goal && !editing && target > 0 && (
            <Card>
              <Micro>This month</Micro>
              <Text className="mt-1 text-[28px] font-extrabold text-ink">
                {goal.signed} of {target} plans
              </Text>
              <View className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/10" accessibilityLabel={`${Math.round(progress * 100)}% of your goal`}>
                <View className="h-full rounded-full bg-flame" style={{ width: `${progress * 100}%` }} />
              </View>
              <Text className="mt-3 text-[14px] text-muted">
                Worth <Text className="font-semibold text-ok">{formatPounds(goal.worthPence)} a month</Text> to you so far, after our 20%.
              </Text>
              {met ? (
                <Text className="mt-2 text-[14px] font-semibold text-ink">Goal met. Every plan from here is a bonus.</Text>
              ) : goal.behind ? (
                <Text className="mt-2 text-[14px] font-semibold text-warn">
                  You&apos;re behind: {Math.ceil(goal.pace) - goal.signed} more gets you back on track. Offer one at the end of your next job.
                </Text>
              ) : (
                <Text className="mt-2 text-[14px] text-muted">You&apos;re on track.</Text>
              )}
            </Card>
          )}

          {editing ? (
            <Card>
              <Text className="text-[15px] font-semibold text-ink">How many plans will you sign this month?</Text>
              <Text className="mt-0.5 text-[12.5px] leading-[18px] text-muted">Most engineers start with 10. You can change it any time.</Text>
              <TextInput
                value={value}
                onChangeText={(v) => {
                  setValue(v.replace(/[^0-9]/g, ""));
                  setError(null);
                }}
                placeholder="10"
                placeholderTextColor="#6e86a3"
                keyboardType="number-pad"
                maxLength={3}
                accessibilityLabel="Plans this month"
                className={`mt-3 min-h-[52px] rounded-xl border-[1.5px] bg-[#081321] px-4 text-[17px] text-white ${error ? "border-danger" : "border-white/20"}`}
              />
              {error && <Text className="mt-1.5 text-[13px] text-danger">{error}</Text>}
              <Button className="mt-3" onPress={save} disabled={busy}>
                {busy ? "Saving…" : "Set my goal"}
              </Button>
            </Card>
          ) : (
            <>
              <Button onPress={() => router.push("/offer")}>Offer a plan</Button>
              <Button variant="ghost" onPress={() => setEditing(true)}>
                Change my goal
              </Button>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
