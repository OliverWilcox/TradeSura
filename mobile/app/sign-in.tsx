import { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, Linking, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { api, ApiError } from "@/lib/api";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

  const canSubmit = email.includes("@") && !busy;

  async function requestLink() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ ok: boolean; devLink?: string }>("/api/auth/request", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSent(true);
      setDevLink(data.devLink ?? null);
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
            <Text className="font-mono-medium text-[11px] uppercase tracking-[3px] text-brand-blue-lift">
              Care Plan Platform
            </Text>
            <Text className="font-disp-bold text-[42px] uppercase leading-[1.05] tracking-wide text-night-text">
              Trade<Text className="text-brand-blue-lift">Sura</Text>
            </Text>
            <Text className="mt-1 max-w-[30ch] font-sans text-[15px] leading-5 text-night-muted">
              Care plans your customers sign at the end of the job, collected by Direct Debit.
            </Text>
          </View>

          <View className="gap-3.5 pb-2">
            {sent ? (
              <>
                <Text className="font-sans-semibold text-night-text">Check your email</Text>
                <Text className="font-sans text-sm text-night-muted">
                  We&apos;ve sent a sign-in link to <Text className="text-night-text">{email}</Text>.
                  It&apos;s valid for 15 minutes.
                </Text>
                {devLink && (
                  <Pressable onPress={() => Linking.openURL(devLink)}>
                    <Text className="text-center font-mono text-xs text-brand-blue-lift underline">
                      DEV: open sign-in link
                    </Text>
                  </Pressable>
                )}
              </>
            ) : (
              <>
                <Text className="font-sans text-sm text-night-muted">
                  Enter your email — we&apos;ll send a link to sign in, no password needed.
                </Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="you@example.com"
                  placeholderTextColor="#5E6975"
                  className="rounded-xl border border-iron bg-night-card px-4 py-3 font-sans text-night-text"
                />
                {error && <Text className="font-sans text-sm text-danger">{error}</Text>}
                <Pressable
                  onPress={requestLink}
                  disabled={!canSubmit}
                  className={`items-center rounded-xl bg-brand-blue py-3.5 ${canSubmit ? "" : "opacity-50"}`}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="font-sans-semibold text-white">Send magic link</Text>
                  )}
                </Pressable>
                <Link href="/sign-up" asChild>
                  <Pressable className="items-center rounded-xl border-[1.5px] border-iron py-3.5">
                    <Text className="font-sans-semibold text-night-text">Create an account</Text>
                  </Pressable>
                </Link>
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
