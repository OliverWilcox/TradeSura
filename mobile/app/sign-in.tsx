import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Lockup } from "@/components/ui";
import { Icon } from "@/components/icon";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { checkEmail, checkUkMobile } from "@/lib/validate";
import { AppleSignInButton, type AppleResult } from "@/components/apple-sign-in";

const BLUE = "#5FA3F0";
const RESEND_AFTER_S = 60;
const SUPPORT_EMAIL = "info@tradesura.com";

type CodeStep = { requestToken: string; maskedEmail: string; devCode?: string };

// Build Guide v2 Part 4 sign-in render: branding top, form bottom, over the
// W0 photo. 4 Oct build notes, section 2: email → 4-digit code → signed in
// (by text once SMS is live) — an email address alone no longer opens an
// account. The button is always full-strength white — tapping it with a bad
// email shows why, it never sits there grey and dead (29 Sept review).
export default function SignIn() {
  const { signIn } = useAuth();
  const [smsMode, setSmsMode] = useState(false);
  const [smsAvailable, setSmsAvailable] = useState(false);
  useEffect(() => {
    api<{ smsAvailable: boolean }>("/api/auth/options")
      .then((data) => setSmsAvailable(data.smsAvailable))
      .catch(() => setSmsAvailable(false));
  }, []);
  const [email, setEmail] = useState("");
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [codeStep, setCodeStep] = useState<CodeStep | null>(null);
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function requestCode() {
    const invalid = smsMode ? checkUkMobile(email) : checkEmail(email);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    setNoAccount(false);
    try {
      const data = await api<
        | { codeSent: true; requestToken: string; maskedEmail: string; devCode?: string }
        | { token: string }
      >(smsMode ? "/api/auth/sms" : "/api/auth/request", {
        method: "POST",
        body: JSON.stringify(smsMode ? { phone: email } : { email: email.trim().toLowerCase() }),
      });
      if ("token" in data) {
        // SIGNIN_CODES=off on the server (temporary — see lib/sign-in-code.ts).
        await signIn(data.token);
        router.replace("/");
        return;
      }
      setCodeStep({ requestToken: data.requestToken, maskedEmail: data.maskedEmail, devCode: data.devCode });
      setCode(data.devCode ?? "");
      setResendIn(RESEND_AFTER_S);
    } catch (e) {
      if (e instanceof ApiError && (e.body as { code?: string } | undefined)?.code === "no_account") {
        setNoAccount(true);
      }
      setError(
        e instanceof ApiError
          ? e.message
          : `We couldn't sign you in. Please try again — if it keeps happening, email ${SUPPORT_EMAIL}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (busy || !codeStep || value.length !== 4) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ token: string }>(smsMode ? "/api/auth/sms" : "/api/auth/verify", {
        method: "POST",
        body: JSON.stringify({ requestToken: codeStep.requestToken, code: value, ...(smsMode ? {phone: email} : {}) }),
      });
      await signIn(data.token);
      router.replace("/");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : `We couldn't check that code. Please try again — if it keeps happening, email ${SUPPORT_EMAIL}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    setCode(digits);
    if (error) setError(null);
    if (digits.length === 4) verify(digits);
  }

  // Section 4.2 — Sign in with Apple is sign-in *and* sign-up: a new Apple
  // ID drops straight into sign-up step 1 with name and email pre-filled.
  async function onApple(r: AppleResult) {
    if (r.kind === "signedIn") {
      await signIn(r.token);
      router.replace("/");
      return;
    }
    router.replace({
      pathname: "/sign-up",
      params: {
        appleToken: r.appleToken,
        ...(r.firstName ? { appleFirst: r.firstName } : {}),
        ...(r.lastName ? { appleLast: r.lastName } : {}),
        ...(r.email ? { appleEmail: r.email } : {}),
      },
    });
  }

  function emailSupport() {
    setHelpOpen(false);
    const subject = encodeURIComponent("Can't sign in to TradeSura");
    const body = encodeURIComponent(
      "Hi TradeSura — I can't sign in.\n\nMy name:\nMy Gas Safe number:\n",
    );
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
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
              onPress={() => {
                if (codeStep) {
                  setCodeStep(null);
                  setCode("");
                  setError(null);
                } else if (router.canGoBack()) router.back();
                else router.replace("/welcome");
              }}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
              className="mt-2 h-10 w-10 justify-center"
            >
              <Icon name="back" size={22} weight="semibold" />
            </Pressable>

            <View className="mt-6">
              <Text className="tabular-nums text-[12.5px] font-bold uppercase tracking-[4px] text-brand-blue-lift">
                Care plan platform
              </Text>
              <View className="mt-2.5">
                <Lockup height={61} />
              </View>
              {/* Section 4.4 — returning engineers don't need the sell. */}
              <Text className="mt-3 text-[18px] font-semibold text-white">Welcome back.</Text>
            </View>

            <View className="flex-1" />

            {smsMode && (
              <Pressable
                onPress={() => {
                  setSmsMode(false);
                  setEmail("");
                  setCodeStep(null);
                  setCode("");
                  setError(null);
                }}
                className="items-center py-1"
              >
                <Text className="text-[15px] text-brand-blue">Use email instead</Text>
              </Pressable>
            )}
            {/* Build Review 2 — brighter text on a soft dark backing so it
                reads over the photo. */}
            {Platform.OS !== "web" && (
              <View className="mt-4 self-start rounded-lg bg-black/45 px-3 py-2">
                <Text className="text-[13px] text-white/90">
                  Stay signed in. Next time, unlock with Face ID or your device security.
                </Text>
              </View>
            )}
            {codeStep ? (
              <View className="gap-3.5 pt-8">
                <Text className="text-[16px] leading-[22px] text-white/90">
                  {codeStep.devCode
                    ? "Email isn't switched on here, so nothing was sent — your test code is filled in below."
                    : `Enter the 4-digit code we sent to ${codeStep.maskedEmail}`}
                </Text>
                <TextInput
                  value={code}
                  onChangeText={onCodeChange}
                  autoFocus
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={4}
                  placeholder="4-digit code"
                  placeholderTextColor="#9fb6d0"
                  accessibilityLabel="Sign-in code"
                  className={`min-h-[58px] rounded-2xl border-[1.5px] bg-[#081321]/90 px-4 tabular-nums text-[22px] tracking-[6px] text-white ${error ? "border-danger" : "border-brand-blue"}`}
                />
                {error && <Text className="-mt-1 text-[14px] text-danger">{error}</Text>}
                <Pressable
                  onPress={() => verify(code)}
                  disabled={busy}
                  className="items-center rounded-xl bg-white py-3.5"
                >
                  {busy ? (
                    <ActivityIndicator color="#0F2140" />
                  ) : (
                    <Text className="font-semibold text-on-light">Sign in</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={requestCode}
                  disabled={resendIn > 0 || busy}
                  hitSlop={8}
                  className="items-center py-1"
                >
                  <Text className="text-[15px]" style={{ color: resendIn > 0 ? "#6e86a3" : BLUE }}>
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View className="gap-3.5 pt-8">
                <AppleSignInButton onResult={onApple} />
                <Text className="text-[16px] text-white/90">{smsMode ? "Enter your verified mobile number." : "Enter your email to sign in."}</Text>
                <TextInput
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    if (error) setError(null);
                    setNoAccount(false);
                  }}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onSubmitEditing={requestCode}
                  returnKeyType="go"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={smsMode ? "tel" : "email"}
                  textContentType={smsMode ? "telephoneNumber" : "emailAddress"}
                  keyboardType={smsMode ? "phone-pad" : "email-address"}
                  placeholder={smsMode ? "07700 900123" : "you@example.com"}
                  placeholderTextColor="#9fb6d0"
                  className={`min-h-[58px] rounded-2xl border-[1.5px] bg-[#081321]/90 px-4 text-[17px] text-white ${error ? "border-danger" : focused ? "border-brand-blue" : "border-white/40"}`}
                />
                {error && <Text className="-mt-1 text-[14px] text-danger">{error}</Text>}
                <Pressable
                  onPress={requestCode}
                  disabled={busy}
                  className="items-center rounded-xl bg-white py-3.5"
                >
                  {busy ? (
                    <ActivityIndicator color="#0F2140" />
                  ) : (
                    <Text className="font-semibold text-on-light">Sign in</Text>
                  )}
                </Pressable>
                {/* Section 4.3 */}
                <Pressable onPress={() => setHelpOpen(true)} hitSlop={8} className="items-center py-1">
                  <Text className="text-[15px]" style={{ color: BLUE }}>
                    Can&apos;t sign in?
                  </Text>
                </Pressable>
                {/* Section 4.1 — the "create an account" route sits right
                    there, made primary-adjacent when the email isn't found. */}
                <Pressable
                  onPress={() => router.push("/sign-up")}
                  className={`items-center rounded-xl border-[1.5px] py-3.5 ${noAccount ? "border-white" : "border-white/55"}`}
                >
                  <Text className="font-semibold text-white">Create an account</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={helpOpen} transparent animationType="fade" onRequestClose={() => setHelpOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setHelpOpen(false)}>
          <Pressable className="gap-3 rounded-t-3xl bg-bg px-5 pb-10 pt-5" onPress={() => {}}>
            <Text className="text-[18px] font-bold text-white">Can&apos;t sign in?</Text>
            {/* Section 4.3's "Sign in with my mobile instead" needs SMS —
                added when texts are switched on (Twilio). */}
            {smsAvailable && (
              <Pressable
                onPress={() => {
                  setSmsMode(true);
                  setEmail("");
                  setCodeStep(null);
                  setCode("");
                  setError(null);
                  setHelpOpen(false);
                }}
                className="rounded-xl border-[1.5px] border-white/55 px-4 py-3.5"
              >
                <Text className="font-semibold text-white">Sign in with my mobile instead</Text>
                <Text className="mt-0.5 text-[13px] text-white/65">
                  We&apos;ll text a four-digit code to your verified mobile.
                </Text>
              </Pressable>
            )}
            <Pressable onPress={emailSupport} className="rounded-xl border-[1.5px] border-white/55 px-4 py-3.5">
              <Text className="font-semibold text-white">Email support</Text>
              <Text className="mt-0.5 text-[13px] text-white/65">
                Send us your name and Gas Safe number and we&apos;ll get you back in.
              </Text>
            </Pressable>
            <Pressable onPress={() => setHelpOpen(false)} className="items-center py-2">
              <Text className="text-white/60">Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
