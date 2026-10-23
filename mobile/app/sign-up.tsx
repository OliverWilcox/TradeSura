import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import {
  api,
  apiUrl,
  ApiError,
  clearSignupDraft,
  getSignupDraft,
  setSignupDraft,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Lockup } from "@/components/ui";
import { Icon } from "@/components/icon";
import { RingMark } from "@/components/ring-mark";
import { IdCardPicker, type IdCardState, type IdPhoto } from "@/components/id-card-picker";
import { AppleSignInButton, type AppleResult } from "@/components/apple-sign-in";
import { AddressLookupField } from "@/components/address-lookup";
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
type Office = { line1: string; town: string; postcode: string };
type Company = {
  name: string;
  number: string;
  status: string | null;
  town: string | null;
  office?: Office | null;
};

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

const STEP_LABELS = ["You", "Gas Safe", "Business"] as const;

const BLUE = "#5FA3F0";

type FieldKey =
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "gasSafeNo"
  | "gasSafeCard"
  | "tradingName"
  | "companyNumber"
  | "soleOwner"
  | "postcode";

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
  soleOwner: 3,
  postcode: 3,
};

// Saved progress (step 1 item 12). The verified-phone token is kept only
// while it's still comfortably inside its 30-minute life on the server.
type Draft = {
  step: 1 | 2 | 3;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  heardVia: HeardVia | null;
  referralCode: string;
  interestTrades: string[];
  gasSafeNo: string;
  tradingName: string;
  businessType: BusinessType;
  companyNumber: string;
  company: Company | null;
  soleOwner?: boolean | null;
  postcode: string;
  addressLine1?: string;
  town?: string;
  marketingConsent: boolean;
  phoneToken: string | null;
  phoneTexted?: boolean;
  emailToken?: string | null;
  smsEnabled?: boolean;
  savedAt: number;
};
const PHONE_TOKEN_KEEP_MS = 25 * 60 * 1000;

const labelCls = "mb-1.5 mt-3.5 text-[14px] font-medium text-white";

// 30 Sept build notes: ~56pt fields with the text a size up — room for
// thumbs in a van. Placeholders are hint text only — never pre-filled values.
function Input({
  error,
  right,
  ...props
}: TextInputProps & { error?: string | null; right?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="justify-center">
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
        className={`h-14 rounded-xl border bg-[#081321] px-3.5 py-0 text-[17px] text-white ${right ? "pr-20" : ""} ${props.editable === false ? "text-white/70" : ""} ${error ? "border-danger" : focused ? "border-brand-blue" : "border-white/30"}`}
      />
      {right && <View className="absolute right-3.5">{right}</View>}
    </View>
  );
}

function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <Text className="mt-1.5 text-[13px] leading-[17px] text-danger">{children}</Text>;
}

function Hint({ children }: { children: ReactNode }) {
  return <Text className="mt-1.5 text-[12.5px] leading-[17px] text-white/70">{children}</Text>;
}

// A plain blue tick for "verified" / "selected" — never a checkbox, so
// nobody thinks they need to tick it (30 Sept build notes).
function BlueTick({ size = 14 }: { size?: number }) {
  return <Icon name="check" size={size} color={BLUE} weight="bold" />;
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <View
      className={`h-[20px] w-[20px] items-center justify-center rounded-[4px] border-[1.5px] ${checked ? "border-brand-blue bg-brand-blue" : "border-white/40"}`}
    >
      {checked && <Icon name="check" size={11} color="#0f2140" weight="bold" />}
    </View>
  );
}

function PrimaryButton({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      className="mt-3.5 min-h-[54px] items-center justify-center rounded-xl bg-white"
    >
      {busy ? (
        <ActivityIndicator color="#0F2140" />
      ) : (
        <Text className="text-[16px] font-bold text-on-light">{label}</Text>
      )}
    </Pressable>
  );
}

function openDoc(path: "/terms" | "/privacy") {
  WebBrowser.openBrowserAsync(apiUrl(path)).catch(() => {});
}

// Slides the code box in under the mobile field.
function SlideIn({ children }: { children: ReactNode }) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [v]);
  return (
    <Animated.View
      style={{
        opacity: v,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

// Build Guide v2 Part 4 — "The interstitial. Ring orbits then docks,
// 'Building your account, {first name}'. Plays once ever, straight after
// Step 3." Then the setup wizard (build your first plan) — never the bare
// dashboard (29 Sept review, systemic defect 3; re-checked 30 Sept).
// Build Review 3, P2 — "Loading screen too quick": the spinning logo stays
// at least 4 seconds, worded "Building your free TradeSura account, {name}".
const BUILDING_MIN_MS = 4000;
const BUILDING_SPINS = 3;
function BuildingAccount({ firstName }: { firstName: string }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [dock] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.sequence([
      Animated.timing(spin, {
        toValue: BUILDING_SPINS,
        duration: BUILDING_MIN_MS - 500,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(dock, { toValue: 1, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => router.replace("/onboarding"), BUILDING_MIN_MS);
    return () => clearTimeout(t);
  }, [spin, dock]);
  const rotate = spin.interpolate({
    inputRange: [0, BUILDING_SPINS],
    outputRange: ["0deg", `${BUILDING_SPINS * 360}deg`],
  });
  const scale = dock.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] });
  return (
    <View className="flex-1 items-center justify-center bg-night px-8">
      <Animated.View style={{ transform: [{ rotate }, { scale }] }}>
        <RingMark size={96} />
      </Animated.View>
      <Text className="mt-8 text-center text-[20px] font-bold text-white">
        Building your free TradeSura account{firstName ? `, ${firstName}` : ""}
      </Text>
    </View>
  );
}

export default function SignUp() {
  const { signIn } = useAuth();
  const {
    code: claimCodeParam,
    ref: refParam,
    src: srcParam,
    appleToken: appleTokenParam,
    appleFirst,
    appleLast,
    appleEmail,
  } = useLocalSearchParams<{
    code?: string;
    ref?: string;
    src?: string;
    // From sign-in's "Continue with Apple" with a new Apple ID (4 Oct notes 4.2).
    appleToken?: string;
    appleFirst?: string;
    appleLast?: string;
    appleEmail?: string;
  }>();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [claim, setClaim] = useState<ClaimResolved | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string | null>>>({});
  const [building, setBuilding] = useState(false);
  const [restored, setRestored] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  // Build Review 2, section 10 — anonymous sign-up funnel for the admin
  // dashboard; one random id per attempt joins the steps together.
  const funnelId = useRef(Math.random().toString(36).slice(2, 12)).current;
  const logStep = useCallback(
    (n: number) => {
      api("/api/telemetry/welcome", {
        method: "POST",
        body: JSON.stringify({ event: "signup_step_reached", meta: { step: n, funnelId } }),
      }).catch(() => {});
    },
    [funnelId],
  );
  useEffect(() => {
    logStep(1);
  }, [logStep]);
  const contentRef = useRef<View>(null);
  // Field wrapper nodes, for scrolling the first failing one into view. A
  // Map held in state (not a ref) so render-time ref callbacks can reach it.
  const [fieldNodes] = useState(() => new Map<FieldKey, View>());

  // The source is known from the link they arrived on (letter QR, invite,
  // email) — then "How did you hear about us?" is skipped and recorded
  // automatically (step 1 item 10).
  const linkSource: HeardVia | null = claimCodeParam
    ? "letter"
    : refParam
      ? "engineer"
      : HEARD_OPTIONS.some((o) => o.value === srcParam)
        ? (srcParam as HeardVia)
        : null;

  // Step 1 — account basics
  const [firstName, setFirstName] = useState(appleFirst ?? "");
  const [lastName, setLastName] = useState(appleLast ?? "");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(appleEmail ?? "");
  const [otpRequestToken, setOtpRequestToken] = useState<string | null>(null);
  const [emailToken, setEmailToken] = useState<string | null>(null);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsAvailable, setSmsAvailable] = useState(false);
  const [otpChannel, setOtpChannel] = useState<"email" | "sms">("email");
  const [resendIn, setResendIn] = useState(0);
  useEffect(() => { api<{smsAvailable: boolean}>("/api/auth/options").then(d => setSmsAvailable(d.smsAvailable)).catch(() => {}); }, []);
  useEffect(() => { if (resendIn <= 0) return; const t = setTimeout(() => setResendIn(s => s - 1), 1000); return () => clearTimeout(t); }, [resendIn]);
  const [otpCode, setOtpCode] = useState("");
  const verifyingRef = useRef(false);
  const [phoneToken, setPhoneToken] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [heardVia, setHeardVia] = useState<HeardVia | null>(linkSource);
  const [referralOpen, setReferralOpen] = useState(Boolean(refParam));
  const [referralCode, setReferralCode] = useState(refParam ?? "");
  const [referral, setReferral] = useState<Referral>({
    status: refParam ? "checking" : "idle",
  });
  const [step1Busy, setStep1Busy] = useState(false);
  // From "Continue with Apple" — links the Apple ID to the new account.
  const [appleToken, setAppleToken] = useState<string | null>(appleTokenParam ?? null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [phoneTexted, setPhoneTexted] = useState(false);

  // Step 2 — trade + Gas Safe
  const [interestTrades, setInterestTrades] = useState<Set<string>>(new Set());
  const [gasSafeNo, setGasSafeNo] = useState("");
  const [card, setCard] = useState<IdCardState>({ phase: "empty" });
  const [cardToken, setCardToken] = useState<string | null>(null);
  const [step2Busy, setStep2Busy] = useState(false);

  // Step 3 — business
  const [tradingName, setTradingName] = useState("");
  const [tradingSuggested, setTradingSuggested] = useState(false);
  const [businessType, setBusinessType] = useState<BusinessType>("sole_trader");
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyResults, setCompanyResults] = useState<Company[]>([]);
  const [companySearching, setCompanySearching] = useState(false);
  const [lookupUnavailable, setLookupUnavailable] = useState(false);
  const [manualCompany, setManualCompany] = useState(false);
  const [company, setCompany] = useState<Company | null>(null);
  const [companyNumber, setCompanyNumber] = useState("");
  const [postcode, setPostcode] = useState("");
  // 4 Oct notes, step 3.1 — correspondence address (where the pack posts).
  const [addressLine1, setAddressLine1] = useState("");
  const [town, setTown] = useState("");
  // Limited companies start on the registered office, with "Use a different
  // address" to switch to the lookup.
  const [usingOffice, setUsingOffice] = useState(false);
  // Build Review 3, section 7 — "Are you the only owner of the company?"
  // (limited companies only); yes lets Stripe skip the owner/director steps.
  const [soleOwner, setSoleOwner] = useState<boolean | null>(null);
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateGasSafe, setDuplicateGasSafe] = useState(false);

  // Restore saved progress once, before anything is saved over it.
  useEffect(() => {
    let cancelled = false;
    getSignupDraft<Draft>().then((d) => {
      if (cancelled) return;
      if (d) {
        const tokenFresh = Boolean(d.phoneToken && d.emailToken) && Date.now() - d.savedAt < PHONE_TOKEN_KEEP_MS;
        setFirstName((p) => p || d.firstName);
        // Apple's pre-fill (from sign-in) wins over an older saved draft.
        setLastName((p) => p || d.lastName);
        setPhone(d.phone);
        setEmail((p) => p || d.email);
        if (!linkSource) setHeardVia(d.heardVia);
        if (!refParam && d.referralCode) {
          setReferralCode(d.referralCode);
          setReferralOpen(true);
          setReferral({ status: "checking" });
        }
        setInterestTrades(new Set(d.interestTrades));
        setGasSafeNo(d.gasSafeNo);
        setTradingName((p) => p || d.tradingName);
        setBusinessType(d.businessType);
        setCompanyNumber(d.companyNumber);
        setCompany(d.company);
        setSoleOwner(d.soleOwner ?? null);
        setPostcode(d.postcode);
        setAddressLine1(d.addressLine1 ?? "");
        setTown(d.town ?? "");
        setMarketingConsent(d.marketingConsent);
        if (tokenFresh) {
          setPhoneToken(d.phoneToken);
          setEmailToken(d.emailToken ?? null);
          setSmsEnabled(Boolean(d.smsEnabled));
          setPhoneTexted(Boolean(d.phoneTexted));
          setStep(d.step);
        }
      }
      setRestored(true);
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: the link params are fixed for this screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored || building) return;
    const t = setTimeout(() => {
      const draft: Draft = {
        step,
        firstName,
        lastName,
        phone,
        email,
        heardVia,
        referralCode,
        interestTrades: [...interestTrades],
        gasSafeNo,
        tradingName,
        businessType,
        companyNumber,
        company,
        soleOwner,
        postcode,
        addressLine1,
        town,
        marketingConsent,
        phoneToken,
        phoneTexted,
        emailToken,
        smsEnabled,
        savedAt: Date.now(),
      };
      setSignupDraft(draft);
    }, 400);
    return () => clearTimeout(t);
  }, [
    restored,
    building,
    step,
    firstName,
    lastName,
    phone,
    email,
    heardVia,
    referralCode,
    interestTrades,
    gasSafeNo,
    tradingName,
    businessType,
    companyNumber,
    company,
    soleOwner,
    postcode,
    addressLine1,
    town,
    marketingConsent,
    phoneToken,
    phoneTexted,
    emailToken,
    smsEnabled,  ]);

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

  // Companies House lookup — through our server, never a key in the app.
  useEffect(() => {
    const q = companyQuery.trim();
    if (businessType !== "ltd" || company || q.length < 2 || !phoneToken) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setCompanySearching(true);
      api<{ items: Company[]; unavailable?: boolean }>("/api/onboarding/companies", {
        method: "POST",
        body: JSON.stringify({ phoneToken, q }),
      })
        .then((r) => {
          if (cancelled) return;
          setCompanyResults(r.items);
          if (r.unavailable) setLookupUnavailable(true);
        })
        .catch(() => {
          if (!cancelled) setLookupUnavailable(true);
        })
        .finally(() => {
          if (!cancelled) setCompanySearching(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [companyQuery, businessType, company, phoneToken]);

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
    if (n > step) logStep(n);
    setStep(n);
    setError(null);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  function onPhoneChange(v: string) {
    changePhone();
    setPhone(v);
    setPhoneTaken(false);
    clearError("phone");
    setOtpError(null);
    if (otpRequestToken) {
      setOtpRequestToken(null);
      setOtpCode("");
    }
  }

  async function onApple(r: AppleResult) {
    if (r.kind === "signedIn") {
      // This Apple ID already has an account — straight in, as sign-in does.
      await clearSignupDraft();
      await signIn(r.token);
      router.replace("/");
      return;
    }
    setAppleToken(r.appleToken);
    if (r.firstName) {
      setFirstName(r.firstName);
      clearError("firstName");
    }
    if (r.lastName) {
      setLastName(r.lastName);
      clearError("lastName");
    }
    if (r.email) {
      setEmail(r.email);
      setEmailTaken(false);
      clearError("email");
    }
  }

  // 4 Oct P0 — one mobile, one account: say so as soon as the number is
  // entered, not as a failure at "Create my free account".
  async function checkPhoneTaken(): Promise<boolean> {
    if (checkUkMobile(phone)) return false;
    try {
      const r = await api<{ available: boolean }>("/api/onboarding/check-phone", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      if (!r.available) {
        setPhoneTaken(true);
        fail({ phone: "This mobile is already registered." });
        return true;
      }
    } catch {
      // Not blocking — the code request below re-checks on the server.
    }
    return false;
  }

  // The verification token covers email + mobile together, so changing
  // either means verifying again.
  function resetVerification() {
    setEmailToken(null);
    setPhoneToken(null);
    setPhoneTexted(false);
    setOtpRequestToken(null);
    setOtpCode("");
    setOtpError(null);
  }

  // "Change" on a verified number: unlock it and start again. The ID-card
  // token is bound to the mobile, so it goes too — but not on an email edit.
  function changePhone() {
    resetVerification();
    setCardToken(null);
  }

  async function sendOtp(): Promise<boolean> {
    const channel = emailToken ? "sms" : "email";
    setOtpChannel(channel);
    setOtpBusy(true);
    setOtpError(null);
    try {
      const data = await api<{ requestToken: string; sent?: boolean; devCode?: string }>(
        "/api/onboarding/contact",
        { method: "POST", body: JSON.stringify({ action: "request", channel, email: email.trim().toLowerCase(), phone, emailToken: emailToken ?? undefined }) },
      );
      setOtpRequestToken(data.requestToken);
      // Only while no SMS provider is configured on the backend (see
      // lib/sms.ts sendVerificationCode) — then the screen says plainly that
      // nothing was texted, and fills the test code in.
      setResendIn(60);
      setOtpCode(data.devCode ?? "");
      return true;
    } catch (e) {
      const taken = e instanceof ApiError ? (e.body as { code?: string } | undefined)?.code : undefined;
      if (taken === "phone_taken") {
        setPhoneTaken(true);
        fail({ phone: "This mobile is already registered." });
        scrollToField("phone");
        return false;
      }
      if (taken === "email_taken") {
        setEmailTaken(true);
        fail({ email: "This email already has an account." });
        return false;
      }
      setOtpError(
        e instanceof ApiError ? e.message : "We couldn't send the code — check your signal and try again.",
      );
      return false;
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyOtp(code: string): Promise<boolean> {
    // Autofill and a Continue tap can both fire — one check at a time.
    if (!otpRequestToken || verifyingRef.current) return false;
    verifyingRef.current = true;
    setOtpBusy(true);
    setOtpError(null);
    try {
      const data = await api<{ phoneToken: string; emailToken: string; texted?: boolean }>("/api/onboarding/contact", {
        method: "POST",
        body: JSON.stringify({ action: "verify", channel: otpChannel, email: email.trim().toLowerCase(), phone, emailToken: emailToken ?? undefined, requestToken: otpRequestToken, code }),
      });
      setPhoneToken(data.phoneToken);
      setEmailToken(data.emailToken);
      setPhoneTexted(Boolean(data.texted));
      setOtpRequestToken(null);
      setOtpCode("");
      clearError("phone");
      return true;
    } catch (e) {
      setOtpError(e instanceof ApiError ? e.message : "Couldn't check that code — try again.");
      return false;
    } finally {
      verifyingRef.current = false;
      setOtpBusy(false);
    }
  }

  function onOtpChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    setOtpCode(digits);
    setOtpError(null);
    // iPhone's code autofill lands all six digits at once — verify straight away.
    if (digits.length === 4 && !otpBusy) verifyOtp(digits);
  }

  // One button does it all (step 1 item 6): the first tap texts the code,
  // the code box slides in, and Continue stays blocked until it matches.
  async function continueStep1() {
    const found: Partial<Record<FieldKey, string | null>> = {
      firstName: checkRequired(firstName, "first name"),
      lastName: checkRequired(lastName, "last name"),
      phone: checkUkMobile(phone),
      email: checkEmail(email),
    };
    if (fail(found)) return;
    setEmailTaken(false);
    setStep1Busy(true);
    // fail() above just cleared the blur check's "already registered" —
    // re-run it so Continue never moves past a taken mobile.
    if (!phoneToken && (await checkPhoneTaken())) {
      setStep1Busy(false);
      scrollToField("phone");
      return;
    }
    try {
      const r = await api<{ available: boolean }>("/api/onboarding/check-email", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!r.available) {
        setEmailTaken(true);
        fail({ email: "This email already has an account." });
        return;
      }
      if (!emailToken || (smsEnabled && !phoneTexted)) {
        if (!otpRequestToken) await sendOtp();
        else if (otpCode.length === 4) await verifyOtp(otpCode);
        else setOtpError("Enter the four-digit code to continue.");
        // Email code first; the SMS one only once email is verified.
        scrollToField(emailToken ? "phone" : "email");
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

  async function uploadCard(photo: IdPhoto) {
    const r = await api<{ cardToken: string }>("/api/onboarding/gas-safe-card", {
      method: "POST",
      body: JSON.stringify({ phoneToken, base64: photo.base64, mimeType: photo.mimeType }),
    });
    setCardToken(r.cardToken);
  }

  function onCardChange(next: IdCardState) {
    setCard(next);
    if (next.phase !== "added") setCardToken(null);
    clearError("gasSafeCard");
  }

  // Continue submits everything — no separate "Submit for verification"
  // button (step 2 item 11). The photo usually uploaded the moment they
  // tapped "Use this photo"; anything unsent goes up here.
  async function continueStep2() {
    const noErr = checkGasSafeNo(gasSafeNo);
    let cardErr: string | null = null;
    if (card.phase === "empty" || card.phase === "denied") {
      cardErr = "Add a photo of your ID card — or tap “I'll add it later”.";
    } else if (card.phase === "uploading") {
      cardErr = "Your photo is still uploading — one moment.";
    } else if (card.phase === "failed") {
      cardErr = "Upload failed — tap the photo to try again.";
    }
    if (fail({ gasSafeNo: noErr, gasSafeCard: cardErr })) return;
    if (card.phase === "preview" || (card.phase === "added" && !cardToken)) {
      const photo = card.photo;
      setStep2Busy(true);
      setCard({ phase: "uploading", photo });
      try {
        await uploadCard(photo);
        setCard({ phase: "added", photo });
      } catch {
        setCard({ phase: "failed", photo });
        fail({ gasSafeCard: "Upload failed — tap the photo to try again." });
        return;
      } finally {
        setStep2Busy(false);
      }
    }
    goToStep(3);
  }

  // "I'll add my ID photo later" (step 2 item 10): the account is still
  // created, the badge stays pending, and the offer gate holds until a
  // reviewer has the photo.
  function skipCard() {
    if (fail({ gasSafeNo: checkGasSafeNo(gasSafeNo) })) return;
    setCard({ phase: "empty" });
    setCardToken(null);
    goToStep(3);
  }

  function toggleInterest(code: string) {
    const next = new Set(interestTrades);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setInterestTrades(next);
  }

  function pickCompany(c: Company) {
    setCompany(c);
    setCompanyNumber(c.number);
    setCompanyResults([]);
    clearError("companyNumber");
    if (!tradingName.trim() || tradingSuggested) {
      setTradingName(titleCase(c.name));
      setTradingSuggested(true);
      clearError("tradingName");
    }
    if (c.office && (!addressLine1.trim() || usingOffice)) {
      setAddressLine1(c.office.line1);
      setTown(c.office.town);
      setPostcode(c.office.postcode);
      setUsingOffice(true);
      clearError("postcode");
    }
  }

  function clearCompany() {
    setCompany(null);
    setCompanyNumber("");
    setCompanyQuery("");
  }

  // Build Review 3, P2 — the company's registered office belongs to the
  // company: changing business type clears it from the address (and a
  // suggested trading name, below), never leaving a sole trader with it.
  function isOfficeAddress(): boolean {
    const o = company?.office;
    if (usingOffice) return true;
    if (!o) return false;
    return (
      addressLine1.trim() === o.line1 &&
      town.trim() === o.town &&
      postcode.replace(/\s/g, "").toUpperCase() === o.postcode.replace(/\s/g, "").toUpperCase()
    );
  }

  function changeBusinessType(value: BusinessType) {
    if (value === businessType) return;
    // Build Review 2 — a name filled in from Companies House belongs to that
    // company; switching type mustn't leave "… Ltd" on a sole trader.
    if (tradingSuggested) {
      setTradingName("");
      setTradingSuggested(false);
    }
    if (isOfficeAddress()) {
      setAddressLine1("");
      setTown("");
      setPostcode("");
      setUsingOffice(false);
    }
    // Back to Limited company with the company still picked and no address
    // typed: its registered office comes back, as when it was first picked.
    if (value === "ltd" && company?.office && !addressLine1.trim()) {
      setAddressLine1(company.office.line1);
      setTown(company.office.town);
      setPostcode(company.office.postcode);
      setUsingOffice(true);
    }
    setBusinessType(value);
    clearError("companyNumber");
    clearError("soleOwner");
    clearError("tradingName");
  }

  // Build Review 3, section 2 — a limited company can leave the trading name
  // blank and trade under its Companies House name; a sole trader (or a
  // partnership, which has no Companies House name) must enter one.
  const legalFallback = businessType === "ltd" && company ? company.name : null;

  const showManualCompany = manualCompany || lookupUnavailable;

  // [DECISION — human, instant-login] No email click-through: the backend
  // hands back a live bearer token directly.
  async function submit() {
    const found: Partial<Record<FieldKey, string | null>> = {
      companyNumber:
        businessType === "ltd"
          ? company
            ? null
            : showManualCompany
              ? checkCompanyNumber(companyNumber)
              : "Find your company, or enter its number instead."
          : null,
      tradingName: legalFallback && !tradingName.trim() ? null : checkRequired(tradingName, "trading name"),
      soleOwner:
        businessType === "ltd" && soleOwner === null
          ? "Tell us whether you're the only owner of the company."
          : null,
      postcode:
        checkUkPostcode(postcode) ??
        (addressLine1.trim() ? null : "Enter your address — or tap Find address and pick it."),
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
            emailToken,
            smsSignInEnabled: smsEnabled,
            trades: [...interestTrades],
            gasSafeNo: gasSafeNo.replace(/\s/g, ""),
            gasSafeCardToken: cardToken ?? undefined,
            tradingName: tradingName.trim(),
            businessType,
            companyNumber:
              businessType === "ltd" ? normaliseCompanyNumber(companyNumber) : undefined,
            companyStatus: businessType === "ltd" && company?.status ? company.status : undefined,
            legalName: legalFallback ?? undefined,
            soleOwner: businessType === "ltd" && soleOwner !== null ? soleOwner : undefined,
            postcode: postcode.trim().toUpperCase(),
            addressLine1: addressLine1.trim() || undefined,
            town: town.trim() || undefined,
            marketingConsent,
            claimCode: claimCodeParam || undefined,
            appleToken: appleToken ?? undefined,
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
      await clearSignupDraft();
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
        if (body?.code === "email_unverified" || body?.code === "phone_unverified") {
          // The 30-minute verification ran out (or the details changed) —
          // drop it so step 1's Continue sends a fresh code.
          setEmailToken(null);
          setPhoneToken(null);
          setPhoneTexted(false);
          setOtpRequestToken(null);
          setOtpCode("");
          setStep(1);
          fail({ [field ?? "email"]: e.message });
        } else if (field) {
          if (FIELD_STEP[field] !== step) setStep(FIELD_STEP[field]);
          if (field === "phone" && body?.code === "phone_taken") {
            setPhoneTaken(true);
            fail({ phone: "This mobile is already registered." });
          } else if (field === "email" && body?.code === "email_taken") {
            setEmailTaken(true);
            fail({ email: "This email already has an account." });
          } else {
            fail({ [field]: e.message });
          }
        } else {
          setError(e.message);
        }
      } else {
        // 4 Oct notes — never "Something went wrong".
        setError(
          "We couldn't create your account. Please try again — if it keeps happening, email info@tradesura.com",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (building) return <BuildingAccount firstName={firstName.trim()} />;

  // Sits under whichever field the code went to — email by default, the
  // mobile only for the optional SMS sign-in.
  const codeBox = otpRequestToken ? (
    <SlideIn>
      <View className="mt-3">
        <Text className="mb-1.5 text-[13.5px] leading-[18px] text-white/85">
          {otpChannel === "email"
            ? `Enter the 4-digit code we emailed to ${email.trim()}.`
            : `Enter the 4-digit code we texted to ${phone}.`}
        </Text>
        <Input
          value={otpCode}
          onChangeText={onOtpChange}
          placeholder="4-digit code"
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={4}
          error={otpError}
          right={otpBusy ? <ActivityIndicator color={BLUE} /> : undefined}
        />
        <FieldError>{otpError}</FieldError>
        <Pressable
          onPress={() => sendOtp()}
          disabled={otpBusy || resendIn > 0}
          className="self-start py-2.5"
        >
          <Text className="text-[14px]" style={{ color: BLUE }}>
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Send a new code"}
          </Text>
        </Pressable>
      </View>
    </SlideIn>
  ) : (
    <FieldError>{otpError}</FieldError>
  );

  const claimed = claim?.valid && claim.personalised;

  return (
    <View className="flex-1 bg-night">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          {/* Build Review 2 — pinned above the scroll so the logo and step
              count never slide under the status bar. */}
          <View className="px-5 pt-2">
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
                <Lockup height={25} />
              </View>
              <Text className="tabular-nums text-[10.5px] font-medium tracking-widest text-white/80">
                STEP {step} OF 3
              </Text>
            </View>
            <View className="h-1 overflow-hidden rounded-full bg-white/15">
              <View
                className="h-full rounded-full bg-brand-blue"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </View>
            {/* Three equal columns (left / centre / right) so "Gas Safe" sits
                in the true middle — space-between centred it by label width. */}
            <View className="mb-4 mt-1.5 flex-row">
              {STEP_LABELS.map((l, i) => (
                <Text
                  key={l}
                  className={`flex-1 text-[12px] ${i === 0 ? "text-left" : i === 1 ? "text-center" : "text-right"} ${i + 1 === step ? "font-semibold text-white" : "text-white/50"}`}
                >
                  {l}
                </Text>
              ))}
            </View>
          </View>
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerClassName="px-5 pb-8"
            keyboardShouldPersistTaps="handled"
          >
            <View ref={contentRef} collapsable={false}>
              {step === 1 && (
                <>
                  <Text
                    className="text-[26px] font-extrabold uppercase tracking-wide text-white"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    Create your free account
                  </Text>
                  <Text className="mb-3 mt-1 text-[14px] leading-[19px] text-white/85">
                    Takes about 2 minutes · Your Verified badge + welcome pack once approved.
                  </Text>

                  <AppleSignInButton onResult={onApple} />

                  <View className="rounded-xl bg-white/[0.04] px-3 pb-3.5 pt-0.5">
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
                          autoCapitalize="words"
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
                          autoCapitalize="words"
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
                        onBlur={() => {
                          if (!phoneToken) checkPhoneTaken();
                        }}
                        placeholder="07123 456789"
                        keyboardType="number-pad"
                        autoComplete="tel"
                        textContentType="telephoneNumber"
                        editable={!phoneToken}
                        error={errors.phone}
                        right={
                          phoneToken ? (
                            <Pressable onPress={changePhone} hitSlop={10}>
                              <Text className="text-[14px] font-medium" style={{ color: BLUE }}>
                                Change
                              </Text>
                            </Pressable>
                          ) : undefined
                        }
                      />
                      {phoneTaken && errors.phone ? (
                        <FieldError>
                          This mobile is already registered.{" "}
                          <Text
                            className="font-semibold underline"
                            style={{ color: BLUE }}
                            onPress={() => router.push("/sign-in")}
                          >
                            Sign in instead?
                          </Text>
                        </FieldError>
                      ) : (
                        <FieldError>{errors.phone}</FieldError>
                      )}
                      {/* 4 Oct notes, step 1.1 — never a verified tick for a
                          check that didn't happen (no text sent yet). */}
                      {phoneToken &&
                        (phoneTexted ? (
                          <View className="mt-2 flex-row items-center gap-1.5">
                            <BlueTick size={14} />
                            <Text className="text-[14px] font-medium text-white">Mobile verified</Text>
                          </View>
                        ) : (
                          <Text className="mt-2 text-[13.5px] leading-[18px] text-white/75">
                            Mobile saved — we&apos;ll verify it by text once text messages are switched on.
                          </Text>
                        ))}
                      <Hint>
                        We&apos;ll only use this to verify you and send your sign-in codes. Never
                        shared, never spammed.
                      </Hint>

                      {otpChannel === "sms" && codeBox}
                    </View>

                    <View ref={fieldRef("email")} collapsable={false}>
                      <Text className={labelCls}>Email</Text>
                      <Input
                        value={email}
                        onChangeText={(v) => {
                          if (v !== email) resetVerification();
                          setEmail(v);
                          setEmailTaken(false);
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
                      {emailTaken && errors.email ? (
                        <FieldError>
                          This email already has an account.{" "}
                          <Text
                            className="font-semibold underline"
                            style={{ color: BLUE }}
                            onPress={() => router.push("/sign-in")}
                          >
                            Sign in instead
                          </Text>
                        </FieldError>
                      ) : (
                        <FieldError>{errors.email}</FieldError>
                      )}
                      {emailToken ? (
                        <View className="mt-2 flex-row items-center gap-1.5">
                          <BlueTick size={14} />
                          <Text className="text-[14px] font-medium text-white">Email verified</Text>
                        </View>
                      ) : (
                        <Hint>We&apos;ll email you a 4-digit code to verify this address.</Hint>
                      )}
                      {otpChannel === "email" && codeBox}
                      {smsAvailable && (
                        <Pressable
                          onPress={() => {
                            setSmsEnabled((v) => !v);
                            setOtpRequestToken(null);
                            setOtpCode("");
                          }}
                          className="mt-3 flex-row items-center gap-2.5 py-1"
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: smsEnabled }}
                        >
                          <Checkbox checked={smsEnabled} />
                          <Text className="flex-1 text-[14px] leading-[19px] text-white">
                            Also set up SMS sign-in (optional)
                          </Text>
                        </Pressable>
                      )}
                    </View>

                    {claimed ? (
                      <View className="mt-4 rounded-xl border border-brand-blue/40 bg-brand-blue/15 px-4 py-3">
                        <Text className="text-[14px] font-semibold text-brand-blue-lift">
                          Claiming the account reserved for {claim.businessName}
                        </Text>
                      </View>
                    ) : (
                      <>
                        {referralOpen ? (
                          <>
                            <Text className={labelCls}>Referral code</Text>
                            <Input
                              value={referralCode}
                              onChangeText={onReferralChange}
                              autoCapitalize="none"
                              autoCorrect={false}
                            />
                            {referral.status === "valid" && (
                              <View className="mt-2 flex-row items-center gap-1.5">
                                <BlueTick size={13} />
                                <Text className="text-[14px] text-white/90">
                                  Referred by {referral.name}
                                </Text>
                              </View>
                            )}
                            {referral.status === "invalid" && (
                              <Hint>
                                We couldn&apos;t find that code — no problem, you can carry on
                                without it.
                              </Hint>
                            )}
                          </>
                        ) : (
                          <Pressable
                            onPress={() => setReferralOpen(true)}
                            className="mt-3.5 self-start py-1"
                          >
                            <Text className="text-[14px]" style={{ color: BLUE }}>
                              Have a referral code?
                            </Text>
                          </Pressable>
                        )}

                        {!linkSource && (
                          <>
                            <Text className={labelCls}>How did you hear about us?</Text>
                            <View className="flex-row flex-wrap gap-1.5">
                              {HEARD_OPTIONS.map((o) => {
                                const on = heardVia === o.value;
                                return (
                                  <Pressable
                                    key={o.value}
                                    onPress={() => setHeardVia(o.value)}
                                    className={`h-9 justify-center rounded-lg border px-3 ${on ? "border-brand-blue bg-brand-blue" : "border-white/30"}`}
                                  >
                                    <Text
                                      className={`text-[13.5px] ${on ? "font-semibold text-on-light" : "text-white"}`}
                                    >
                                      {o.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          </>
                        )}
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

                  <PrimaryButton label="Continue" onPress={continueStep1} busy={step1Busy || otpBusy} />
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
                  <Text
                    className="text-[26px] font-extrabold uppercase tracking-wide text-white"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    Verify your trade
                  </Text>
                  <Text className="mb-3 mt-1 text-[14px] leading-[19px] text-white/85">
                    Customers see your verified badge on every plan you sell — it&apos;s your
                    biggest closer.
                  </Text>

                  <View className="rounded-xl bg-white/[0.04] px-3 pb-3.5 pt-0.5">
                    <Text className={labelCls}>Your trade</Text>
                    <View className="h-14 flex-row items-center gap-2.5 rounded-xl border-[1.5px] border-brand-blue px-3.5">
                      <BlueTick size={15} />
                      <Text className="text-[17px] text-white">Gas / Heating</Text>
                    </View>
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {OTHER_TRADES.map((t) => {
                        const on = interestTrades.has(t.code);
                        return (
                          <Pressable
                            key={t.code}
                            onPress={() => toggleInterest(t.code)}
                            className={`h-9 flex-row items-center gap-1.5 rounded-lg border px-2.5 ${on ? "border-brand-blue" : "border-white/25"}`}
                          >
                            <Text className="overflow-hidden rounded bg-white/10 px-1.5 py-0.5 tabular-nums text-[9px] text-white/70">
                              {on ? "NOTED" : "SOON"}
                            </Text>
                            <Text className="text-[13px] text-white">{t.name}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Hint>Tap any to register interest</Hint>

                    <View ref={fieldRef("gasSafeNo")} collapsable={false}>
                      <Text className={`${labelCls} mt-5`}>Gas Safe registration number</Text>
                      <Input
                        value={gasSafeNo}
                        onChangeText={(v) => {
                          setGasSafeNo(v);
                          clearError("gasSafeNo");
                        }}
                        placeholder="584123"
                        keyboardType="number-pad"
                        maxLength={8}
                        error={errors.gasSafeNo}
                      />
                      <FieldError>{errors.gasSafeNo}</FieldError>
                      <Hint>The registration number on your Gas Safe ID card</Hint>
                    </View>

                    <View ref={fieldRef("gasSafeCard")} collapsable={false}>
                      <Text className={labelCls}>Your Gas Safe ID card</Text>
                      <IdCardPicker
                        value={card}
                        onChange={onCardChange}
                        upload={uploadCard}
                        error={errors.gasSafeCard}
                      />
                      <FieldError>{errors.gasSafeCard}</FieldError>
                      <Hint>
                        Needed for your Verified badge. Only used to verify you — never shown to
                        customers.
                      </Hint>
                    </View>
                  </View>

                  {/* Never implies a link with Gas Safe (30 Sept build notes). */}
                  <Text className="mt-3 text-center text-[13px] leading-[19px] text-white/85">
                    We check every member&apos;s registration, usually within 24 hours. You can
                    build your plans in the meantime.
                  </Text>

                  <PrimaryButton label="Continue" onPress={continueStep2} busy={step2Busy} />
                  <Pressable onPress={skipCard} className="mt-2 items-center py-2.5">
                    <Text className="text-[13.5px] text-white/60">
                      I&apos;ll add it later — you can still build your plans
                    </Text>
                  </Pressable>
                </>
              )}

              {step === 3 && (
                <>
                  <Text
                    className="text-[26px] font-extrabold uppercase tracking-wide text-white"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    Your business
                  </Text>
                  <Text className="mb-3 mt-1 text-[14px] text-white/85">
                    This is the name your customers see on their plan.
                  </Text>

                  <View className="rounded-xl bg-white/[0.04] px-3 pb-3.5 pt-0.5">
                    <Text className={labelCls}>Business type</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {BUSINESS_TYPES.map(([value, label]) => {
                        const on = businessType === value;
                        return (
                          <Pressable
                            key={value}
                            onPress={() => changeBusinessType(value)}
                            className={`h-10 justify-center rounded-lg border-[1.5px] px-3 ${on ? "border-brand-blue bg-brand-blue/10" : "border-white/30"}`}
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
                        {company ? (
                          <>
                            <Text className={labelCls}>Your company</Text>
                            <View className="flex-row items-center gap-3 rounded-xl border border-white/20 border-l-[3px] border-l-brand-blue bg-[#081321] px-3.5 py-3">
                              <View className="flex-1">
                                <Text className="text-[15px] font-semibold text-white">{company.name}</Text>
                                <Text className="mt-0.5 text-[13px] text-white/65">
                                  {[company.number, company.town].filter(Boolean).join(" · ")}
                                </Text>
                              </View>
                              <Pressable onPress={clearCompany} hitSlop={10}>
                                <Text className="text-[14px] font-medium" style={{ color: BLUE }}>
                                  Change
                                </Text>
                              </Pressable>
                            </View>
                          </>
                        ) : showManualCompany ? (
                          <>
                            <Text className={labelCls}>Company number</Text>
                            <Input
                              value={companyNumber}
                              onChangeText={(v) => {
                                setCompanyNumber(v);
                                clearError("companyNumber");
                              }}
                              onBlur={() => setCompanyNumber((n) => normaliseCompanyNumber(n))}
                              placeholder="12345678"
                              autoCapitalize="characters"
                              autoCorrect={false}
                              maxLength={10}
                              error={errors.companyNumber}
                            />
                            {!lookupUnavailable && (
                              <Pressable
                                onPress={() => setManualCompany(false)}
                                className="mt-1 self-start py-1.5"
                              >
                                <Text className="text-[13.5px]" style={{ color: BLUE }}>
                                  Search Companies House instead
                                </Text>
                              </Pressable>
                            )}
                          </>
                        ) : (
                          <>
                            <Text className={labelCls}>Find your company</Text>
                            <Input
                              value={companyQuery}
                              onChangeText={(v) => {
                                setCompanyQuery(v);
                                clearError("companyNumber");
                              }}
                              placeholder="Company name or number"
                              autoCorrect={false}
                              error={errors.companyNumber}
                              right={
                                companySearching ? (
                                  <ActivityIndicator color={BLUE} />
                                ) : (
                                  <Icon name="search" size={16} color="#6e86a3" />
                                )
                              }
                            />
                            {companyResults.length > 0 && (
                              <View className="mt-1.5 overflow-hidden rounded-xl border border-white/20 bg-[#081321]">
                                {companyResults.map((c, i) => (
                                  <Pressable
                                    key={c.number}
                                    onPress={() => pickCompany(c)}
                                    className={`px-3.5 py-3 ${i > 0 ? "border-t border-white/10" : ""}`}
                                  >
                                    <Text className="text-[14.5px] font-semibold text-white">{c.name}</Text>
                                    <Text className="mt-0.5 text-[12.5px] text-white/60">
                                      {[c.number, c.town].filter(Boolean).join(" · ")}
                                    </Text>
                                  </Pressable>
                                ))}
                              </View>
                            )}
                            <Hint>Search by company name or number</Hint>
                            <Pressable
                              onPress={() => setManualCompany(true)}
                              className="mt-1 self-start py-1.5"
                            >
                              <Text className="text-[13.5px]" style={{ color: BLUE }}>
                                Enter the company number instead
                              </Text>
                            </Pressable>
                          </>
                        )}
                        <FieldError>{errors.companyNumber}</FieldError>
                      </View>
                    )}

                    <View ref={fieldRef("tradingName")} collapsable={false}>
                      <Text className={labelCls}>
                        Trading name{legalFallback ? " (optional)" : ""}
                      </Text>
                      <Input
                        value={tradingName}
                        onChangeText={(v) => {
                          setTradingName(v);
                          setTradingSuggested(false);
                          clearError("tradingName");
                        }}
                        placeholder="e.g. Smith Heating"
                        autoCapitalize="words"
                        autoComplete="organization"
                        textContentType="organizationName"
                        error={errors.tradingName}
                      />
                      <FieldError>{errors.tradingName}</FieldError>
                      {legalFallback && !tradingName.trim() && (
                        <Hint>Leave blank to use {legalFallback}</Hint>
                      )}
                      {tradingSuggested && (
                        <Hint>
                          Suggested from Companies House — change it if you trade under another name
                        </Hint>
                      )}
                      {/* Build Review 3 — a warning, never a block. */}
                      {businessType !== "ltd" && /\b(ltd|limited)\b/i.test(tradingName) && (
                        <Text className="mt-1.5 text-[12.5px] leading-[17px] text-warn">
                          Only limited companies can use &ldquo;Ltd&rdquo; in their name — pick Limited company
                          above, or take it out.
                        </Text>
                      )}
                    </View>

                    {businessType === "ltd" && (
                      <View ref={fieldRef("soleOwner")} collapsable={false}>
                        <Text className={labelCls}>Are you the only owner of the company?</Text>
                        <View className="flex-row gap-2">
                          {([
                            [true, "Yes"],
                            [false, "No"],
                          ] as const).map(([value, label]) => {
                            const on = soleOwner === value;
                            return (
                              <Pressable
                                key={label}
                                onPress={() => {
                                  setSoleOwner(value);
                                  clearError("soleOwner");
                                }}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: on }}
                                className={`h-10 min-w-[72px] items-center justify-center rounded-lg border-[1.5px] px-3 ${on ? "border-brand-blue bg-brand-blue/10" : "border-white/30"}`}
                              >
                                <Text className={`text-[14px] ${on ? "text-brand-blue-lift" : "text-white"}`}>
                                  {label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <FieldError>{errors.soleOwner}</FieldError>
                      </View>
                    )}

                    <View ref={fieldRef("postcode")} collapsable={false}>
                      <Text className={labelCls}>Correspondence address</Text>
                      {usingOffice && businessType === "ltd" ? (
                        <View className="rounded-xl border-[1.5px] border-white/20 bg-[#081321] px-4 py-3">
                          <Text className="text-[15px] text-white">{addressLine1}</Text>
                          <Text className="text-[15px] text-white">
                            {town} {postcode}
                          </Text>
                          <Text className="mt-1 text-[12.5px] text-white/55">
                            Registered office, from Companies House
                          </Text>
                          <Pressable onPress={() => setUsingOffice(false)} hitSlop={8} className="mt-2">
                            <Text className="text-[14px] font-medium" style={{ color: BLUE }}>
                              Use a different address
                            </Text>
                          </Pressable>
                        </View>
                      ) : (
                        <AddressLookupField
                          large
                          phoneToken={phoneToken}
                          emailToken={emailToken}
                          value={{ line1: addressLine1, town, postcode }}
                          onChange={(v) => {
                            setAddressLine1(v.line1);
                            setTown(v.town);
                            setPostcode(v.postcode);
                            clearError("postcode");
                          }}
                          postcodeError={errors.postcode}
                        />
                      )}
                      <Hint>Where we&apos;ll post your member pack. Customers aren&apos;t shown this.</Hint>
                    </View>

                    {/* Opt-in, unticked by default — the legally correct shape. */}
                    <Pressable
                      onPress={() => setMarketingConsent(!marketingConsent)}
                      className="mt-4 flex-row items-center gap-2.5 py-1"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: marketingConsent }}
                    >
                      <Checkbox checked={marketingConsent} />
                      <Text className="flex-1 text-[14px] leading-[19px] text-white">
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

                  <Text className="mt-4 text-center text-[13px] leading-[18px] text-white/85">
                    By creating your account you agree to our{" "}
                    <Text className="text-brand-blue-lift" onPress={() => openDoc("/terms")}>
                      Terms of Service
                    </Text>{" "}
                    and{" "}
                    <Text className="text-brand-blue-lift" onPress={() => openDoc("/privacy")}>
                      Privacy Policy
                    </Text>
                    .
                  </Text>
                  {/* Always active — a tap with something missing highlights it. */}
                  <PrimaryButton label="Create my free account" onPress={submit} busy={busy} />
                  <Pressable onPress={() => goToStep(2)} className="mt-3 items-center py-2">
                    <Text className="text-[14px] text-brand-blue-lift">← Back</Text>
                  </Pressable>
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// Companies House names are upper case ("SMITH HEATING LTD"); the suggested
// trading name reads like a name ("Smith Heating Ltd").
// 4 Oct notes, step 3.3: letters after "&" and apostrophes stay capitals
// ("J&D Heating Ltd", "O'Neill Gas") — except a possessive s ("Smith's").
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/'S\b/g, "'s")
    .replace(/\bLtd\b/g, "Ltd")
    .replace(/\b(Plc|Llp|Llc|Uk)\b/g, (m) => m.toUpperCase())
    // Small joining words stay lower case, except as the first word.
    .replace(/(?!^)\b(And|Of|The|For|In|On|At)\b/g, (m) => m.toLowerCase());
}
