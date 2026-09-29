import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Lockup } from "@/components/ui";
import { Icon } from "@/components/icon";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { checkEmail } from "@/lib/validate";

// Build Guide v2 Part 4 sign-in render: branding top, form bottom, over the
// W0 photo. The button is always full-strength white — tapping it with a bad
// email shows why, it never sits there grey and dead (29 Sept review).
export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // [DECISION — human, instant-login] No email click-through: on success the
  // backend hands back a live bearer token directly (see app/api/auth/request
  // in the Next.js backend) — knowing the email is the only check left here.
  async function signInNow() {
    const invalid = checkEmail(email);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ token: string }>("/api/auth/request", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      await signIn(data.token);
      router.replace("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-night">
      <AuthBackdrop />
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="flex-grow px-5 pb-4"
            keyboardShouldPersistTaps="handled"
          >
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/welcome"))}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
              className="mt-2 h-10 w-10 justify-center"
            >
              <Icon name="back" size={22} weight="semibold" />
            </Pressable>

            <View className="mt-6">
              <Text className="font-mono text-[12.5px] font-medium uppercase tracking-[4px] text-brand-blue-lift">
                Care plan platform
              </Text>
              <View className="mt-2.5">
                <Lockup height={52} />
              </View>
              <Text className="mt-3 max-w-[330px] text-[16px] leading-[22px] text-white/90">
                Care plans your customers sign at the end of the job, collected by Direct Debit.
              </Text>
            </View>

            <View className="flex-1" />

            <View className="gap-3.5 pt-8">
              <Text className="text-[16px] text-white/90">Enter your email to sign in.</Text>
              <TextInput
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  if (error) setError(null);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSubmitEditing={signInNow}
                returnKeyType="go"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor="#9fb6d0"
                className={`min-h-[58px] rounded-2xl border-[1.5px] bg-[#081321]/90 px-4 text-[17px] text-white ${error ? "border-danger" : focused ? "border-brand-blue" : "border-white/40"}`}
              />
              {error && <Text className="-mt-1 text-[14px] text-danger">{error}</Text>}
              <Pressable
                onPress={signInNow}
                disabled={busy}
                className="items-center rounded-xl bg-white py-3.5"
              >
                {busy ? (
                  <ActivityIndicator color="#0F2140" />
                ) : (
                  <Text className="font-semibold text-on-light">Sign in</Text>
                )}
              </Pressable>
              <Link href="/sign-up" asChild>
                <Pressable className="items-center rounded-xl border-[1.5px] border-white/55 py-3.5">
                  <Text className="font-semibold text-white">Create an account</Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
