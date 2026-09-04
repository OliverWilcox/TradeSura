import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.includes("@") && !busy;

  // [DECISION — human, instant-login] No email click-through: on success the
  // backend hands back a live bearer token directly (see app/api/auth/request
  // in the Next.js backend) — knowing the email is the only check left here.
  async function signInNow() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ token: string }>("/api/auth/request", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      await signIn(data.token);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-night">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        <ScrollView
          contentContainerClassName="flex-grow px-6 pb-6 pt-10"
          keyboardShouldPersistTaps="handled"
        >
          <View className="flex-1 justify-center gap-2.5">
            <Text className="font-mono font-medium text-[11px] uppercase tracking-[3px] text-brand-blue-lift">
              Care Plan Platform
            </Text>
            <Text className="font-bold text-[42px] uppercase leading-[1.05] tracking-wide text-night-text">
              Trade<Text className="text-brand-blue-lift">Sura</Text>
            </Text>
            <Text className="mt-1 max-w-[30ch] font-sans text-[15px] leading-5 text-night-muted">
              Care plans your customers sign at the end of the job, collected by Direct Debit.
            </Text>
          </View>

          <View className="gap-3.5 pb-2">
            <Text className="font-sans text-sm text-night-muted">
              Enter your email to sign in.
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="you@example.com"
              placeholderTextColor="#8B95A1"
              className="rounded-xl border border-iron bg-night-card px-4 py-3 font-sans text-night-text"
            />
            {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
            <Pressable
              onPress={signInNow}
              disabled={!canSubmit}
              className={`items-center rounded-xl bg-brand-blue py-3.5 ${canSubmit ? "" : "opacity-50"}`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="font-semibold text-white">Sign in</Text>
              )}
            </Pressable>
            <Link href="/sign-up" asChild>
              <Pressable className="items-center rounded-xl border-[1.5px] border-iron py-3.5">
                <Text className="font-semibold text-night-text">Create an account</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
