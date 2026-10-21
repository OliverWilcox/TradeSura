import { useState } from "react";
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { AppHeader, Card, Button, Tick } from "@/components/ui";

// Getting started · "Member pack" — the free QR boiler stickers and cards,
// posted once the Gas Safe badge goes live. Moved out of the hub card so
// every hub step is one tappable row (2026 Build Guide hub target).
export default function MemberPack() {
  const { me, refreshMe } = useAuth();
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = Boolean(me?.packRequestedAt);

  async function save() {
    if (address.trim().length < 10) {
      setError("Enter your full postal address, including the postcode.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/api/onboarding/pack", { method: "POST", body: JSON.stringify({ address: address.trim() }) });
      await refreshMe();
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save your address.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-panel">
      <SafeAreaView edges={["top"]} className="bg-iron">
        <AppHeader title="Getting started · Member pack" />
      </SafeAreaView>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-3 px-4 pb-10 pt-4" keyboardShouldPersistTaps="handled">
          <View>
            <Text className="text-[22px] font-bold text-ink">Your free member pack</Text>
            <Text className="mt-1.5 text-[14.5px] leading-[21px] text-muted">
              QR boiler stickers that link each boiler to its Home Passport, plus cards to hand over
              at every job. It posts when your Gas Safe badge goes live.
            </Text>
          </View>
          {done ? (
            <Card>
              <View className="flex-row items-center gap-2">
                <Tick size={14} />
                <Text className="text-[15px] font-semibold text-ink">Address saved</Text>
              </View>
              <Text className="mt-1.5 text-[14px] text-muted">
                {me?.gasSafeVerifiedAt
                  ? "Your pack is on its way."
                  : "We'll post it as soon as your badge goes live."}
              </Text>
            </Card>
          ) : (
            <Card>
              <Text className="text-[13px] font-bold uppercase tracking-[0.1em] text-flame">Where should we post it?</Text>
              <TextInput
                value={address}
                onChangeText={(v) => {
                  setAddress(v);
                  setError(null);
                }}
                placeholder="Full postal address, including postcode"
                placeholderTextColor="#6e86a3"
                multiline
                textAlignVertical="top"
                className="mt-2 min-h-[96px] rounded-xl border border-line-strong bg-bg px-3.5 py-3 text-[16px] text-ink"
              />
              {error && <Text className="mt-1.5 text-[13px] text-danger">{error}</Text>}
              <Button className="mt-3" onPress={save} disabled={busy}>
                {busy ? "Saving…" : "Send my pack"}
              </Button>
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
