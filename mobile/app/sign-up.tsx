import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as WebBrowser from "expo-web-browser";
import { api, apiUrl, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Lockup, Tick } from "@/components/ui";
import { Icon } from "@/components/icon";
import { RingMark } from "@/components/ring-mark";
import {
  checkCompanyNumber,
  checkEmail,
  checkGasSafeNo,
  checkRequired,
  checkUkMobile,
  checkUkPostcode,
  normaliseCompanyNumber,
} from "@/lib/validate";

type ClaimResolved =
  | { valid: true; personalised: boolean; firstName?: string; businessName?: string; letterBatch: string; variantCell: string }
  | { valid: false };

type BusinessType = "sole_trader" | "ltd" | "partnership";
type HeardVia = "letter" | "email" | "engineer" | "online" | "other";
type Referral = { status: "idle" | "checking" | "valid" | "invalid"; name?: string };

const HEARD_OPTIONS: { value: HeardVia; label: string }[] = [
  { value: "letter", label: "Letter" },
  { value: "email", label: "Email" },
  { value: "engineer", label: "Another engineer" },
  { value: "online", label: "Online" },
  { value: "other", label: "Other" },
];

// Hand-duplicated from ../../lib/trades.ts — Metro's watchFolders keeps this
// app's resolution scoped to mobile/ (see mobile/CLAUDE.md).
const OTHER_TRADES = [
  { code: "HEAT_PUMP", name: "Heat Pump" },
  { code: "ELECTRICAL", name: "Electrical" },
  { code: "OIL", name: "Oil" },
  { code: "SOLAR", name: "Solar" },
  { code: "AIRCON", name: "Air Con" },
] as const;

const BUSINESS_TYPES: [BusinessType, string][] = [
  ["sole_trader", "Sole trader"],
  ["ltd", "Limited company"],
  ["partnership", "Partnership"],
];

type FieldKey =
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "gasSafeNo"
  | "gasSafeCard"
  | "tradingName"
  | "companyNumber"
  | "postcode"
  | "terms";

// Which step owns each field — a server-side rejection jumps back to it.
const FIELD_STEP: Record<FieldKey, 1 | 2 | 3> = {
  firstName: 1,
  lastName: 1,
  phone: 1,
  email: 1,
  gasSafeNo: 2,
  gasSafeCard: 2,
  tradingName: 3,
  companyNumber: 3,
  postcode: 3,
  terms: 3,
};

const labelCls = "mb-1.5 mt-3 text-[13.5px] font-medium text-white";

// 29 Sept review: outlined, high-contrast inputs sized for thumbs in a van.
// Placeholders are hint text only — never pre-filled values.
function Input({ error, ...props }: TextInputProps & { error?: string | null }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor="#6e86a3"
      {...props}
      onFocus={(e) => {
        setFocused(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        props.onBlur?.(e);
      }}
      className={`min-h-[42px] rounded-lg border bg-[#081321] px-3 text-[15px] text-white ${error ? "border-danger" : focused ? "border-brand-blue" : "border-white/30"}`}
    />
  );
}

function FieldError({ children }: { children?: string | null }) {
  if (!children) return null;
  return <Text className="mt-1.5 text-[12.5px] leading-[17px] text-danger">{children}</Text>;
}

function Hint({ children }: { children: ReactNode }) {
  return <Text className="mt-1.5 text-[12px] leading-[16px] text-white/75">{children}</Text>;
}

function OutlineButton({
  children,
  onPress,
  busy,
}: {
  children: string;
  onPress: () => void;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="mt-2.5 min-h-[40px] items-center justify-center rounded-lg border border-brand-blue"
    >
      {busy ? (
        <ActivityIndicator color="#8cc0f7" />
      ) : (
        <Text className="text-[14.5px] font-medium text-brand-blue-lift">{children}</Text>
      )}
    </Pressable>
  );
}

function Checkbox({ checked, error }: { checked: boolean; error?: boolean }) {
  return (
    <View
      className={`h-[19px] w-[19px] items-center justify-center rounded-[4px] border-[1.5px] ${checked ? "border-brand-blue bg-brand-blue" : error ? "border-danger" : "border-white/40"}`}
    >
      {checked && <Icon name="check" size={11} color="#0f2140" weight="bold" />}
    </View>
  );
}

function openDoc(path: "/terms" | "/privacy") {
  WebBrowser.openBrowserAsync(apiUrl(path)).catch(() => {});
}

// Build Guide v2 Part 4 — "The interstitial. Ring orbits then docks,
// 'Building your account, {first name}'. Plays once ever, straight after
// Step 3." Then the Getting Started hub — the onboarding wizard fires
// after signup (29 Sept review, systemic defect 3).
function BuildingAccount({ firstName }: { firstName: string }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [dock] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.sequence([
      Animated.timing(spin, {
        toValue: 1,
        duration: 1300,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(dock, { toValue: 1, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => router.replace("/onboarding"), 2000);
    return () => clearTimeout(t);
  }, [spin, dock]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "720deg"] });
  const scale = dock.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] });
  return (
    <View className="flex-1 items-center justify-center bg-night px-8">
      <Animated.View style={{ transform: [{ rotate }, { scale }] }}>
        <RingMark size={96} />
      </Animated.View>
      <Text className="mt-8 text-center text-[20px] font-bold text-white">
        Building your account{firstName ? `, ${firstName}` : ""}
      </Text>
    </View>
  );
}

export default function SignUp() {
  const { signIn } = useAuth();
  const { code: claimCodeParam, ref: refParam } = useLocalSearchParams<{
    code?: string;
    ref?: string;
  }>();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [claim, setClaim] = useState<ClaimResolved | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string | null>>>({});
  const [building, setBuilding] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  // Field wrapper nodes, for scrolling the first failing one into view. A
  // Map held in state (not a ref) so render-time ref callbacks can reach it.
  const [fieldNodes] = useState(() => new Map<FieldKey, View>());

  // Step 1 — account basics
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otpRequestToken, setOtpRequestToken] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [phoneToken, setPhoneToken] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [heardVia, setHeardVia] = useState<HeardVia | null>(refParam ? "engineer" : null);
  const [referralCode, setReferralCode] = useState(refParam ?? "");
  const [referral, setReferral] = useState<Referral>({
    status: refParam ? "checking" : "idle",
  });
  const [step1Busy, setStep1Busy] = useState(false);

  // Step 2 — trade + Gas Safe
  const [interestTrades, setInterestTrades] = useState<Set<string>>(new Set());
  const [gasSafeNo, setGasSafeNo] = useState("");
  const [card, setCard] = useState<{ uri: string; base64: string; mimeType: string } | null>(null);
  const [cardToken, setCardToken] = useState<string | null>(null);
  const [cardBusy, setCardBusy] = useState(false);

  // Step 3 — business
  const [tradingName, setTradingName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("sole_trader");
  const [companyNumber, setCompanyNumber] = useState("");
  const [postcode, setPostcode] = useState("");
  const [termsConsent, setTermsConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateGasSafe, setDuplicateGasSafe] = useState(false);

  // C5 — arrived from a letter claim link: resolve the code and pre-fill.
  useEffect(() => {
    if (!claimCodeParam) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api<ClaimResolved>(
          `/api/claim/resolve?code=${encodeURIComponent(claimCodeParam)}`,
        );
        if (cancelled) return;
        setClaim(r);
        if (r.valid && r.personalised) {
          if (r.firstName) setFirstName((prev) => prev || r.firstName!);
          if (r.businessName) setTradingName((prev) => prev || r.businessName!);
          setHeardVia("letter");
        }
      } catch {
        /* not a dead end — fall through to the normal wizard */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimCodeParam]);

  // Referral code — accepted or politely rejected, never blocking. Checked
  // as they type (debounced) so the answer is there before Continue.
  function onReferralChange(v: string) {
    setReferralCode(v);
    setReferral({ status: v.trim() ? "checking" : "idle" });
  }

  useEffect(() => {
    const code = referralCode.trim();
    if (!code) return;
    const t = setTimeout(() => {
      api<{ valid: boolean; name?: string }>(`/api/referral/check?code=${encodeURIComponent(code)}`)
        .then((r) => setReferral(r.valid ? { status: "valid", name: r.name } : { status: "invalid" }))
        .catch(() => setReferral({ status: "idle" }));
    }, 450);
    return () => clearTimeout(t);
  }, [referralCode]);

  function fieldRef(key: FieldKey) {
    return (v: View | null) => {
      if (v) fieldNodes.set(key, v);
      else fieldNodes.delete(key);
    };
  }

  // Deferred a frame so a step switch (server error on an earlier step) has
  // rendered the field before it's measured.
  function scrollToField(key: FieldKey) {
    setTimeout(() => {
      const node = fieldNodes.get(key);
      const content = contentRef.current;
      if (!node || !content) return;
      node.measureLayout(content, (_x, y) => {
        scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
      });
    }, 50);
  }

  function clearError(key: FieldKey) {
    if (errors[key]) setErrors((e) => ({ ...e, [key]: null }));
  }

  // Shows every failing field at once and scrolls to the first — a button
  // never fails silently (29 Sept review, systemic defect 1).
  function fail(found: Partial<Record<FieldKey, string | null>>): boolean {
    setErrors(found);
    const first = (Object.keys(found) as FieldKey[]).find((k) => found[k]);
    if (!first) return false;
    scrollToField(first);
    return true;
  }

  function goToStep(n: 1 | 2 | 3) {
    setStep(n);
    setError(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function onPhoneChange(v: string) {
    setPhone(v);
    clearError("phone");
    setOtpError(null);
    // A verified phone that's since been edited needs re-verifying.
    if (phoneToken || otpRequestToken) {
      setPhoneToken(null);
      setOtpRequestToken(null);
      setOtpCode("");
      setCardToken(null);
    }
  }

  async function sendOtp() {
    const invalid = checkUkMobile(phone);
    if (invalid) {
      fail({ phone: invalid });
      return;
    }
    setOtpBusy(true);
    setOtpError(null);
    clearError("phone");
    try {
      const data = await api<{ requestToken: string; devCode?: string }>(
        "/api/onboarding/phone/start",
        { method: "POST", body: JSON.stringify({ phone }) },
      );
      setOtpRequestToken(data.requestToken);
      // Only present while no SMS provider is configured on the backend —
      // see lib/sms.ts sendVerificationCode. Real texts never echo the code.
      if (data.devCode) setOtpCode(data.devCode);
    } catch (e) {
      setOtpError(e instanceof ApiError ? e.message : "Couldn't send the code — try again.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyOtp() {
    if (otpCode.trim().length < 4) {
      setOtpError("Enter the 6-digit code we texted you.");
      return;
    }
    setOtpBusy(true);
    setOtpError(null);
    try {
      const data = await api<{ phoneToken: string }>("/api/onboarding/phone/verify", {
        method: "POST",
        body: JSON.stringify({ requestToken: otpRequestToken, code: otpCode.trim() }),
      });
      setPhoneToken(data.phoneToken);
      clearError("phone");
    } catch (e) {
      setOtpError(e instanceof ApiError ? e.message : "Couldn't verify that code.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function continueStep1() {
    const found: Partial<Record<FieldKey, string | null>> = {
      firstName: checkRequired(firstName, "first name"),
      lastName: checkRequired(lastName, "last name"),
      phone:
        checkUkMobile(phone) ??
        (phoneToken
          ? null
          : otpRequestToken
            ? "Enter the code we texted you, then tap Verify code."
            : "Verify your mobile — tap Send verification code."),
      email: checkEmail(email),
    };
    if (fail(found)) return;
    setStep1Busy(true);
    try {
      const r = await api<{ available: boolean }>("/api/onboarding/check-email", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!r.available) {
        fail({ email: "This email already has an account — sign in instead." });
        return;
      }
    } catch (e) {
      fail({ email: e instanceof ApiError ? e.message : "Couldn't check that email — try again." });
      return;
    } finally {
      setStep1Busy(false);
    }
    goToStep(2);
  }

  async function pickCard(source: "camera" | "library") {
    clearError("gasSafeCard");
    const perm =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      fail({
        gasSafeCard:
          source === "camera"
            ? "Allow camera access in Settings to photograph your card — or choose a photo instead."
            : "Allow photo access in Settings to choose your card photo.",
      });
      return;
    }
    // Low quality on purpose: a 12MP phone photo at full quality blows past
    // the API's request-size limit, and a card only needs to be legible.
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.35, base64: true };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    setCard({ uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType ?? "image/jpeg" });
    setCardToken(null);
  }

  // "Submit for verification" — the wording is a legal position (29 Sept
  // review): we never claim to have checked the register here. The photo
  // is stored now; creating the account is what enters the admin queue.
  async function submitForVerification(): Promise<boolean> {
    const found = {
      gasSafeNo: checkGasSafeNo(gasSafeNo),
      gasSafeCard: card ? null : "Add a photo of the front of your Gas Safe ID card.",
    };
    if (fail(found)) return false;
    if (cardToken) return true;
    setCardBusy(true);
    try {
      const r = await api<{ cardToken: string }>("/api/onboarding/gas-safe-card", {
        method: "POST",
        body: JSON.stringify({ phoneToken, base64: card!.base64, mimeType: card!.mimeType }),
      });
      setCardToken(r.cardToken);
      return true;
    } catch (e) {
      fail({ gasSafeCard: e instanceof ApiError ? e.message : "Couldn't upload your card — try again." });
      return false;
    } finally {
      setCardBusy(false);
    }
  }

  async function continueStep2() {
    if (await submitForVerification()) goToStep(3);
  }

  function toggleInterest(code: string) {
    const next = new Set(interestTrades);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setInterestTrades(next);
  }

  // [DECISION — human, instant-login] No email click-through: the backend
  // hands back a live bearer token directly.
  async function submit() {
    const found: Partial<Record<FieldKey, string | null>> = {
      tradingName: checkRequired(tradingName, "trading name"),
      companyNumber: businessType === "ltd" ? checkCompanyNumber(companyNumber) : null,
      postcode: checkUkPostcode(postcode),
      terms: termsConsent ? null : "Tick to agree to the Terms of Service and Privacy Policy.",
    };
    if (fail(found)) return;
    setBusy(true);
    setError(null);
    setDuplicateGasSafe(false);
    try {
      const data = await api<{ token: string; trades: string[] }>("/api/auth/request", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          signup: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phoneToken,
            trades: [...interestTrades],
            gasSafeNo: gasSafeNo.replace(/\s/g, ""),
            gasSafeCardToken: cardToken ?? undefined,
            tradingName: tradingName.trim(),
            businessType,
            companyNumber:
              businessType === "ltd" ? normaliseCompanyNumber(companyNumber) : undefined,
            postcode: postcode.trim().toUpperCase(),
            marketingConsent,
            claimCode: claimCodeParam || undefined,
            attribution: claim?.valid
              ? {
                  heardVia: "letter",
                  letterBatch: claim.letterBatch,
                  variantCell: claim.variantCell,
                }
              : {
                  heardVia: heardVia ?? (referral.status === "valid" ? "engineer" : undefined),
                  ...(referral.status === "valid" ? { referralCode: referralCode.trim() } : {}),
                },
          },
        }),
      });
      await signIn(data.token);
      for (const code of data.trades) {
        await api("/api/trades/interest", {
          method: "POST",
          body: JSON.stringify({ code }),
        }).catch(() => {
          // best-effort — a missed interest registration isn't worth blocking signup over
        });
      }
      setBuilding(true);
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.body as { code?: string; field?: FieldKey } | undefined;
        setDuplicateGasSafe(body?.code === "duplicate_gas_safe_no");
        const field = body?.field && body.field in FIELD_STEP ? body.field : null;
        if (field) {
          if (FIELD_STEP[field] !== step) setStep(FIELD_STEP[field]);
          fail({ [field]: e.message });
        } else {
          setError(e.message);
        }
      } else {
        setError("Something went wrong — check your connection and try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (building) return <BuildingAccount firstName={firstName.trim()} />;

  const claimed = claim?.valid && claim.personalised;

  return (
    <View className="flex-1 bg-night">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerClassName="px-5 pb-8 pt-2"
            keyboardShouldPersistTaps="handled"
          >
            <View ref={contentRef} collapsable={false}>
              <View className="mb-3 flex-row items-center gap-2">
                <Pressable
                  onPress={() =>
                    step > 1
                      ? goToStep((step - 1) as 1 | 2)
                      : router.canGoBack()
                        ? router.back()
                        : router.replace("/welcome")
                  }
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  className="h-10 w-8 justify-center"
                >
                  <Icon name="back" size={22} weight="semibold" />
                </Pressable>
                <View className="flex-1">
                  <Lockup height={26} />
                </View>
                <Text className="font-mono text-[11px] font-medium tracking-widest text-white/80">
                  STEP {step} OF 3
                </Text>
              </View>
              <View className="mb-5 h-1 overflow-hidden rounded-full bg-white/15">
                <View
                  className="h-full rounded-full bg-brand-blue"
                  style={{ width: `${(step / 3) * 100}%` }}
                />
              </View>

              {step === 1 && (
                <>
                  <Text className="text-[25px] font-extrabold uppercase tracking-wide text-white">
                    Create your account
                  </Text>
                  <Text className="mb-3 mt-0.5 text-[14px] text-white/85">
                    Takes about 2 minutes. No card needed.
                  </Text>

                  <View className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 pb-4 pt-0.5">
                    <View className="flex-row gap-3">
                      <View ref={fieldRef("firstName")} collapsable={false} className="flex-1">
                        <Text className={labelCls}>First name</Text>
                        <Input
                          value={firstName}
                          onChangeText={(v) => {
                            setFirstName(v);
                            clearError("firstName");
                          }}
                          placeholder="Dave"
                          autoComplete="given-name"
                          textContentType="givenName"
                          error={errors.firstName}
                        />
                        <FieldError>{errors.firstName}</FieldError>
                      </View>
                      <View ref={fieldRef("lastName")} collapsable={false} className="flex-1">
                        <Text className={labelCls}>Last name</Text>
                        <Input
                          value={lastName}
                          onChangeText={(v) => {
                            setLastName(v);
                            clearError("lastName");
                          }}
                          placeholder="Smith"
                          autoComplete="family-name"
                          textContentType="familyName"
                          error={errors.lastName}
                        />
                        <FieldError>{errors.lastName}</FieldError>
                      </View>
                    </View>

                    <View ref={fieldRef("phone")} collapsable={false}>
                      <Text className={labelCls}>Mobile number</Text>
                      <Input
                        value={phone}
                        onChangeText={onPhoneChange}
                        placeholder="07123 456789"
                        keyboardType="phone-pad"
                        autoComplete="tel"
                        textContentType="telephoneNumber"
                        error={errors.phone}
                      />
                      <FieldError>{errors.phone}</FieldError>
                      <Hint>We&apos;ll text a quick code to verify this number.</Hint>

                      {phoneToken ? (
                        <View className="mt-2.5 min-h-[40px] flex-row items-center gap-2 rounded-lg border border-white/15 px-3">
                          <Tick size={13} />
                          <Text className="text-[14px] font-semibold text-white">Mobile verified</Text>
                        </View>
                      ) : otpRequestToken ? (
                        <View className="mt-3">
                          <Text className="mb-1.5 text-[13px] text-white/85">
                            Enter the code we texted to {phone}.
                          </Text>
                          <Input
                            value={otpCode}
                            onChangeText={(v) => {
                              setOtpCode(v);
                              setOtpError(null);
                            }}
                            placeholder="123456"
                            keyboardType="number-pad"
                            autoComplete="sms-otp"
                            textContentType="oneTimeCode"
                            error={otpError}
                          />
                          <FieldError>{otpError}</FieldError>
                          <OutlineButton onPress={verifyOtp} busy={otpBusy}>
                            Verify code
                          </OutlineButton>
                          <Pressable onPress={sendOtp} disabled={otpBusy} className="items-center py-3">
                            <Text className="text-[14px] text-white/75 underline">Resend code</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <>
                          <FieldError>{otpError}</FieldError>
                          <OutlineButton onPress={sendOtp} busy={otpBusy}>
                            Send verification code
                          </OutlineButton>
                        </>
                      )}
                    </View>

                    <View ref={fieldRef("email")} collapsable={false}>
                      <Text className={labelCls}>Email</Text>
                      <Input
                        value={email}
                        onChangeText={(v) => {
                          setEmail(v);
                          clearError("email");
                        }}
                        placeholder="dave@smithheating.co.uk"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="email"
                        textContentType="emailAddress"
                        error={errors.email}
                      />
                      <FieldError>{errors.email}</FieldError>
                      {errors.email?.includes("already has an account") && (
                        <Link href="/sign-in" asChild>
                          <Pressable className="py-1">
                            <Text className="text-[14px] text-brand-blue-lift underline">
                              Sign in instead
                            </Text>
                          </Pressable>
                        </Link>
                      )}
                      <Hint>You&apos;ll sign in with this email — make sure it&apos;s right.</Hint>
                    </View>

                    {claimed ? (
                      <View className="mt-4 rounded-xl border border-brand-blue/40 bg-brand-blue/15 px-4 py-3">
                        <Text className="text-[14px] font-semibold text-brand-blue-lift">
                          Claiming the account reserved for {claim.businessName}
                        </Text>
                      </View>
                    ) : (
                      <>
                        {/* The £50 referral scheme's attribution — always
                            visible, pre-filled from an invite link. */}
                        <Text className={labelCls}>Referral code (optional)</Text>
                        <Input
                          value={referralCode}
                          onChangeText={onReferralChange}
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                        {referral.status === "valid" && (
                          <View className="mt-2 flex-row items-center gap-1.5">
                            <Tick size={13} />
                            <Text className="text-[14px] text-white/90">
                              Referred by {referral.name}
                            </Text>
                          </View>
                        )}
                        {referral.status === "invalid" && (
                          <Hint>
                            We couldn&apos;t find that code — no problem, you can carry on without it.
                          </Hint>
                        )}

                        <Text className={labelCls}>How did you hear about us?</Text>
                        <View className="flex-row flex-wrap gap-2">
                          {HEARD_OPTIONS.map((o) => {
                            const on = heardVia === o.value;
                            return (
                              <Pressable
                                key={o.value}
                                onPress={() => setHeardVia(o.value)}
                                className={`min-h-[34px] justify-center rounded-lg border px-3 ${on ? "border-brand-blue bg-brand-blue" : "border-white/30"}`}
                              >
                                <Text className={`text-[13.5px] ${on ? "font-semibold" : ""} text-white`}>
                                  {o.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      </>
                    )}
                  </View>

                  <Text className="mt-4 text-center text-[13px] text-white/85">
                    By continuing you agree to our{" "}
                    <Text className="text-brand-blue-lift" onPress={() => openDoc("/terms")}>
                      Terms
                    </Text>{" "}
                    and{" "}
                    <Text className="text-brand-blue-lift" onPress={() => openDoc("/privacy")}>
                      Privacy Policy
                    </Text>
                  </Text>

                  <Pressable
                    onPress={continueStep1}
                    disabled={step1Busy}
                    className="mt-3.5 items-center rounded-xl bg-white py-3"
                  >
                    {step1Busy ? (
                      <ActivityIndicator color="#0F2140" />
                    ) : (
                      <Text className="text-[15px] font-bold text-on-light">Continue</Text>
                    )}
                  </Pressable>
                  <Link href="/sign-in" asChild>
                    <Pressable className="mt-4 py-1">
                      <Text className="text-center text-[14px] text-white/85">
                        Already have an account? <Text className="text-brand-blue-lift">Sign in</Text>
                      </Text>
                    </Pressable>
                  </Link>
                </>
              )}

              {step === 2 && (
                <>
                  <Text className="text-[25px] font-extrabold uppercase tracking-wide text-white">
                    Verify your trade
                  </Text>
                  <Text className="mb-3 mt-0.5 text-[14px] leading-[20px] text-white/85">
                    Customers see your verified badge on every plan you sell — it&apos;s your
                    biggest closer.
                  </Text>

                  <View className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 pb-4 pt-0.5">
                    <Text className={labelCls}>Your trade</Text>
                    <View className="min-h-[42px] flex-row items-center gap-2 rounded-lg border-[1.5px] border-brand-blue px-3">
                      <Icon name="check" size={13} weight="bold" />
                      <Text className="text-[15px] text-white">Gas / Heating</Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      className="-mx-4 mt-3"
                      contentContainerClassName="gap-2 px-4"
                    >
                      {OTHER_TRADES.map((t) => {
                        const on = interestTrades.has(t.code);
                        return (
                          <Pressable
                            key={t.code}
                            onPress={() => toggleInterest(t.code)}
                            className={`min-h-[32px] flex-row items-center gap-1.5 rounded-lg border px-2.5 ${on ? "border-brand-blue" : "border-white/25"}`}
                          >
                            <Text className="text-[13px] text-white">{t.name}</Text>
                            <Text className="overflow-hidden rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] text-white/70">
                              {on ? "NOTED" : "SOON"}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                    <Hint>Tap any to register interest</Hint>

                    <View ref={fieldRef("gasSafeNo")} collapsable={false}>
                      <Text className={`${labelCls} mt-5`}>Gas Safe registration number</Text>
                      <Input
                        value={gasSafeNo}
                        onChangeText={(v) => {
                          setGasSafeNo(v);
                          clearError("gasSafeNo");
                          setCardToken(null);
                        }}
                        placeholder="584123"
                        keyboardType="number-pad"
                        maxLength={9}
                        error={errors.gasSafeNo}
                      />
                      <FieldError>{errors.gasSafeNo}</FieldError>
                    </View>

                    <View
                      ref={fieldRef("gasSafeCard")}
                      collapsable={false}
                      className={`mt-3.5 rounded-lg border p-3.5 ${errors.gasSafeCard ? "border-danger" : "border-white/20"}`}
                    >
                      <Pressable
                        onPress={() => pickCard("camera")}
                        className="flex-row items-center gap-4"
                        accessibilityRole="button"
                      >
                        {card ? (
                          <Image source={{ uri: card.uri }} className="h-12 w-[76px] rounded-md" />
                        ) : (
                          <View className="h-10 w-10 items-center justify-center">
                            <Icon name="camera" size={22} />
                          </View>
                        )}
                        <View className="flex-1">
                          <Text className="text-[14.5px] text-white">
                            {card ? "Card photo added" : "Snap the front of your Gas Safe ID card"}
                          </Text>
                          <Text className="mt-0.5 text-[12.5px] text-white/70">
                            {card ? "Tap to retake" : "Required — speeds up your verification"}
                          </Text>
                        </View>
                      </Pressable>
                      {!card && (
                        <Pressable onPress={() => pickCard("library")} className="mt-2 self-start py-1">
                          <Text className="text-[13px] text-brand-blue-lift">
                            Or choose a photo
                          </Text>
                        </Pressable>
                      )}
                      <FieldError>{errors.gasSafeCard}</FieldError>
                      {cardToken ? (
                        <View className="mt-2.5 min-h-[40px] flex-row items-center gap-2 rounded-lg border border-white/15 px-3">
                          <Tick size={13} />
                          <Text className="shrink text-[14px] font-semibold text-white">
                            Submitted for verification
                          </Text>
                        </View>
                      ) : (
                        <OutlineButton onPress={submitForVerification} busy={cardBusy}>
                          Submit for verification
                        </OutlineButton>
                      )}
                    </View>
                  </View>

                  <Text className="mt-3 text-[13px] leading-[19px] text-white/85">
                    We verify every member against the Gas Safe register — usually within 24 hours.
                    You can build your plans in the meantime.
                  </Text>

                  <Pressable
                    onPress={continueStep2}
                    disabled={cardBusy}
                    className="mt-4 items-center rounded-xl bg-white py-3"
                  >
                    {cardBusy ? (
                      <ActivityIndicator color="#0F2140" />
                    ) : (
                      <Text className="text-[15px] font-bold text-on-light">Continue</Text>
                    )}
                  </Pressable>
                  <Pressable onPress={() => goToStep(1)} className="mt-3 items-center py-2">
                    <Text className="text-[14px] text-brand-blue-lift">← Back</Text>
                  </Pressable>
                </>
              )}

              {step === 3 && (
                <>
                  <Text className="text-[25px] font-extrabold uppercase tracking-wide text-white">
                    Your business
                  </Text>
                  <Text className="mb-3 mt-0.5 text-[14px] text-white/85">
                    This is the name your customers see on their plan.
                  </Text>

                  <View className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 pb-4 pt-0.5">
                    <View ref={fieldRef("tradingName")} collapsable={false}>
                      <Text className={labelCls}>Trading name</Text>
                      <Input
                        value={tradingName}
                        onChangeText={(v) => {
                          setTradingName(v);
                          clearError("tradingName");
                        }}
                        placeholder="e.g. Smith Heating"
                        autoCapitalize="words"
                        error={errors.tradingName}
                      />
                      <FieldError>{errors.tradingName}</FieldError>
                    </View>

                    <Text className={labelCls}>Business type</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {BUSINESS_TYPES.map(([value, label]) => {
                        const on = businessType === value;
                        return (
                          <Pressable
                            key={value}
                            onPress={() => {
                              setBusinessType(value);
                              clearError("companyNumber");
                            }}
                            className={`min-h-[36px] justify-center rounded-lg border-[1.5px] px-3 ${on ? "border-brand-blue bg-brand-blue/10" : "border-white/30"}`}
                          >
                            <Text className={`text-[14px] ${on ? "text-brand-blue-lift" : "text-white"}`}>
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {businessType === "ltd" && (
                      <View ref={fieldRef("companyNumber")} collapsable={false}>
                        <Text className={labelCls}>Company number</Text>
                        <Input
                          value={companyNumber}
                          onChangeText={(v) => {
                            setCompanyNumber(v);
                            clearError("companyNumber");
                          }}
                          placeholder="12345678"
                          autoCapitalize="characters"
                          autoCorrect={false}
                          maxLength={10}
                          error={errors.companyNumber}
                        />
                        <FieldError>{errors.companyNumber}</FieldError>
                      </View>
                    )}

                    <View ref={fieldRef("postcode")} collapsable={false}>
                      <Text className={labelCls}>Business postcode</Text>
                      <Input
                        value={postcode}
                        onChangeText={(v) => {
                          setPostcode(v);
                          clearError("postcode");
                        }}
                        placeholder="HD9 2TT"
                        autoCapitalize="characters"
                        autoCorrect={false}
                        autoComplete="postal-code"
                        textContentType="postalCode"
                        error={errors.postcode}
                      />
                      <FieldError>{errors.postcode}</FieldError>
                      <Hint>So we know your patch — customers aren&apos;t shown this.</Hint>
                    </View>

                    <View ref={fieldRef("terms")} collapsable={false} className="mt-4 flex-row items-center gap-2.5">
                      <Pressable
                        onPress={() => {
                          setTermsConsent(!termsConsent);
                          clearError("terms");
                        }}
                        hitSlop={10}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: termsConsent }}
                      >
                        <Checkbox checked={termsConsent} error={Boolean(errors.terms)} />
                      </Pressable>
                      <Text className="flex-1 text-[13.5px] leading-[19px] text-white">
                        I agree to the{" "}
                        <Text className="text-brand-blue-lift" onPress={() => openDoc("/terms")}>
                          Terms of Service
                        </Text>{" "}
                        and{" "}
                        <Text className="text-brand-blue-lift" onPress={() => openDoc("/privacy")}>
                          Privacy Policy
                        </Text>
                      </Text>
                    </View>
                    <FieldError>{errors.terms}</FieldError>
                    <Pressable
                      onPress={() => setMarketingConsent(!marketingConsent)}
                      className="mt-2.5 flex-row items-center gap-2.5"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: marketingConsent }}
                    >
                      <Checkbox checked={marketingConsent} />
                      <Text className="flex-1 text-[13.5px] leading-[19px] text-white">
                        Send me tips and product updates (optional)
                      </Text>
                    </Pressable>
                  </View>

                  {error && <Text className="mt-3 text-[14px] text-danger">{error}</Text>}
                  {duplicateGasSafe && (
                    <Link href="/sign-in" asChild>
                      <Pressable className="mt-1 py-1">
                        <Text className="text-[14px] text-brand-blue-lift underline">
                          Sign in instead
                        </Text>
                      </Pressable>
                    </Link>
                  )}
                  {/* Enabled only once the T&Cs are ticked (29 Sept review). */}
                  <Pressable
                    onPress={submit}
                    disabled={busy || !termsConsent}
                    className={`mt-3.5 items-center rounded-xl bg-white py-3 ${termsConsent ? "" : "opacity-50"}`}
                  >
                    {busy ? (
                      <ActivityIndicator color="#0F2140" />
                    ) : (
                      <Text className="text-[15px] font-bold text-on-light">Create my account</Text>
                    )}
                  </Pressable>
                  <Pressable onPress={() => goToStep(2)} className="mt-3 items-center py-2">
                    <Text className="text-[14px] text-brand-blue-lift">← Back</Text>
                  </Pressable>
                </>
              )}

              <Text className="mt-6 text-center font-mono text-[10px] tracking-wide text-white/60">
                GAS SAFE VERIFIED MEMBERS · PAYOUTS DIRECT TO YOUR BANK · NO CARD REQUIRED
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
