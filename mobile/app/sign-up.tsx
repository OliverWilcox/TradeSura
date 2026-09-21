import { useEffect, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router, useLocalSearchParams } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Lockup, Tick } from "@/components/ui";

type ClaimResolved =
  | { valid: true; personalised: boolean; firstName?: string; businessName?: string; letterBatch: string; variantCell: string }
  | { valid: false };

type Verified = { regNo: string; name: string; company: string; categories: string };
type BusinessType = "sole_trader" | "ltd" | "partnership";
type HeardVia = "letter" | "engineer" | "online" | "other";

const HEARD_OPTIONS: { value: HeardVia; label: string }[] = [
  { value: "letter", label: "Letter" },
  { value: "engineer", label: "Another engineer" },
  { value: "online", label: "Online" },
  { value: "other", label: "Other" },
];

// Hand-duplicated from ../../lib/trades.ts — Metro's watchFolders keeps this
// app's resolution scoped to mobile/ (see mobile/CLAUDE.md), same reason
// tier/[tierId].tsx duplicates small display constants rather than importing
// cross-repo. Only display names/codes here; the compliance-relevant lookup
// itself (verifyGasSafe) stays server-side via /api/verify.
const OTHER_TRADES = [
  { code: "HEAT_PUMP", name: "Heat pump" },
  { code: "ELECTRICAL", name: "Electrical" },
  { code: "OIL", name: "Oil (OFTEC)" },
  { code: "SOLAR", name: "Solar" },
  { code: "AIRCON", name: "Air con" },
] as const;

const inputCls =
  "rounded-[10px] border border-line bg-night-card px-3.5 py-3 font-sans text-[15px] text-night-text";
const labelCls = "mb-1.5 mt-3.5 font-semibold text-[13px] text-night-muted";

export default function SignUp() {
  const { signIn } = useAuth();
  const { code: claimCodeParam, ref: refParam } = useLocalSearchParams<{
    code?: string;
    ref?: string;
  }>();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [claim, setClaim] = useState<ClaimResolved | null>(null);

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

  // Step 2 — trade + Gas Safe
  const [interestTrades, setInterestTrades] = useState<Set<string>>(new Set());
  const [gasSafeNo, setGasSafeNo] = useState("");
  const [gasSafeMatch, setGasSafeMatch] = useState<Verified | null>(null);
  const [gasBusy, setGasBusy] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);
  // review #11 — a checked-but-unmatched (or unreachable) number isn't a
  // dead end: gasChecked flips the UI to the amber "continue anyway" escape
  // hatch instead of just re-showing "Check the register".
  const [gasChecked, setGasChecked] = useState(false);
  const [gasReviewPending, setGasReviewPending] = useState(false);

  // Step 3 — business
  const [tradingName, setTradingName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("sole_trader");
  const [companyNumber, setCompanyNumber] = useState("");
  const [postcode, setPostcode] = useState("");
  const [termsConsent, setTermsConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);

  // Submit
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

  function onPhoneChange(v: string) {
    setPhone(v);
    // A verified phone that's since been edited needs re-verifying.
    if (phoneToken) {
      setPhoneToken(null);
      setOtpRequestToken(null);
      setOtpCode("");
    }
  }

  async function sendOtp() {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const data = await api<{ requestToken: string; devCode?: string }>(
        "/api/onboarding/phone/start",
        { method: "POST", body: JSON.stringify({ phone }) },
      );
      setOtpRequestToken(data.requestToken);
      // Twilio isn't configured (yet) — the backend hands the code straight
      // back instead of only logging it server-side, mirroring the sign-in/
      // sign-up devLink pattern. Pre-filled, not auto-submitted, so it's
      // obvious this is standing in for a real text, not a passwordless skip.
      if (data.devCode) setOtpCode(data.devCode);
    } catch (e) {
      setOtpError(e instanceof ApiError ? e.message : "Couldn't send the code.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function verifyOtp() {
    setOtpBusy(true);
    setOtpError(null);
    try {
      const data = await api<{ phoneToken: string }>("/api/onboarding/phone/verify", {
        method: "POST",
        body: JSON.stringify({ requestToken: otpRequestToken, code: otpCode }),
      });
      setPhoneToken(data.phoneToken);
    } catch (e) {
      setOtpError(e instanceof ApiError ? e.message : "Couldn't verify that code.");
    } finally {
      setOtpBusy(false);
    }
  }

  async function checkGasSafe() {
    setGasBusy(true);
    setGasError(null);
    setGasReviewPending(false);
    try {
      const data = await api<Verified>("/api/verify", {
        method: "POST",
        body: JSON.stringify({ regNo: gasSafeNo }),
      });
      setGasSafeMatch(data);
      if (!tradingName) setTradingName(data.company);
    } catch (e) {
      // Whether it's a clean "no match" (404) or the check couldn't complete
      // at all (network/server error) — either way, this isn't a dead end.
      // The amber card below offers a manual-review escape hatch either way.
      setGasSafeMatch(null);
      setGasError(e instanceof ApiError ? e.message : "Couldn't reach the register.");
    } finally {
      setGasChecked(true);
      setGasBusy(false);
    }
  }

  function continueWithoutMatch() {
    setGasReviewPending(true);
  }

  function toggleInterest(code: string) {
    const next = new Set(interestTrades);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setInterestTrades(next);
  }

  // [DECISION — human, instant-login] No email click-through: the backend
  // hands back a live bearer token directly instead of emailing a magic
  // link, since phone (OTP) and Gas Safe are both already verified by this
  // point in the wizard.
  async function submit() {
    setBusy(true);
    setError(null);
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
            // review #11 — gasSafeMatch is null on the manual-review path, so
            // fall back to what they typed rather than dropping the number.
            gasSafeNo: gasSafeMatch?.regNo ?? gasSafeNo.trim(),
            gasSafeName: gasSafeMatch?.name,
            gasSafeCompany: gasSafeMatch?.company,
            gasSafeCategories: gasSafeMatch?.categories,
            gasSafeReviewRequested: gasReviewPending && !gasSafeMatch,
            tradingName: tradingName.trim(),
            businessType,
            companyNumber: businessType === "ltd" ? companyNumber.trim() || undefined : undefined,
            postcode: postcode.trim().toUpperCase(),
            marketingConsent,
            claimCode: claimCodeParam || undefined,
            attribution:
              claim?.valid
                ? {
                    heardVia: "letter",
                    letterBatch: claim.letterBatch,
                    variantCell: claim.variantCell,
                  }
                : heardVia
                  ? {
                      heardVia,
                      ...(heardVia === "engineer" && referralCode.trim()
                        ? { referralCode: referralCode.trim() }
                        : {}),
                    }
                  : undefined,
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
      router.replace("/");
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.body as { code?: string } | undefined;
        setDuplicateGasSafe(body?.code === "duplicate_gas_safe_no");
        setError(e.message);
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  const step1Valid =
    firstName.trim().length >= 2 &&
    lastName.trim().length >= 2 &&
    Boolean(phoneToken) &&
    email.includes("@") &&
    Boolean(heardVia);
  const step2Valid = Boolean(gasSafeMatch) || gasReviewPending;
  const step3Valid =
    tradingName.trim().length >= 2 && postcode.trim().length >= 4 && termsConsent;

  return (
    <View className="flex-1 bg-night">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-10 pt-4 gap-1">
        <View className="mb-3.5 flex-row items-center justify-between">
          <Lockup height={24} />
          <Text className="font-mono font-medium text-[11px] tracking-widest text-night-muted">
            STEP {step} OF 3
          </Text>
        </View>
        <View className="mb-5 h-[5px] overflow-hidden rounded-full bg-line-strong">
          <View className="h-full rounded-full bg-brand-blue" style={{ width: `${(step / 3) * 100}%` }} />
        </View>

        {step === 1 && (
          <>
            <Text className="font-bold text-[28px] text-night-text uppercase tracking-wide">
              Create your account
            </Text>
            <Text className="mb-2 font-sans text-[14.5px] text-night-muted">
              Takes about 2 minutes. No card needed.
            </Text>

            <View className="rounded-[14px] border border-line bg-night-card p-4">
              <View className="flex-row gap-2.5">
                <View className="flex-1">
                  <Text className={labelCls}>First name</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Dave"
                    placeholderTextColor="#6E86A3"
                    className={inputCls}
                  />
                </View>
                <View className="flex-1">
                  <Text className={labelCls}>Last name</Text>
                  <TextInput
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Smith"
                    placeholderTextColor="#6E86A3"
                    className={inputCls}
                  />
                </View>
              </View>

              <Text className={labelCls}>Mobile number</Text>
              <TextInput
                value={phone}
                onChangeText={onPhoneChange}
                placeholder="07123 456789"
                placeholderTextColor="#6E86A3"
                keyboardType="phone-pad"
                editable={!phoneToken}
                className={inputCls}
              />
              <Text className="mt-1.5 font-sans text-xs text-night-muted">
                We text your customers&apos; signup links from the app — and verify this number by
                code.
              </Text>

              {phoneToken ? (
                <View className="mt-2.5 flex-row items-center gap-1.5 rounded-[10px] border border-line bg-night-card px-3.5 py-2.5">
                  <Tick size={14} />
                  <Text className="font-semibold text-[13.5px] text-night-text">Mobile verified</Text>
                </View>
              ) : otpRequestToken ? (
                <View className="mt-2.5 gap-2">
                  <Text className="font-sans text-xs text-night-muted">
                    Enter the code we texted to {phone}.
                  </Text>
                  <TextInput
                    value={otpCode}
                    onChangeText={setOtpCode}
                    placeholder="123456"
                    placeholderTextColor="#6E86A3"
                    keyboardType="number-pad"
                    className={inputCls}
                  />
                  {otpError && <Text className="font-sans text-[13px] text-danger">{otpError}</Text>}
                  <Pressable
                    onPress={verifyOtp}
                    disabled={otpBusy || otpCode.length < 4}
                    className={`items-center rounded-[10px] border-[1.5px] border-brand-blue py-2.5 ${otpBusy || otpCode.length < 4 ? "opacity-50" : ""}`}
                  >
                    <Text className="font-semibold text-[13.5px] text-brand-blue-lift">
                      {otpBusy ? "Checking…" : "Verify code"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={sendOtp} disabled={otpBusy}>
                    <Text className="text-center font-sans text-xs text-night-muted underline">
                      Resend code
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  {otpError && <Text className="mt-2 font-sans text-[13px] text-danger">{otpError}</Text>}
                  <Pressable
                    onPress={sendOtp}
                    disabled={otpBusy || phone.trim().length < 10}
                    className={`mt-2.5 items-center rounded-[10px] border-[1.5px] border-brand-blue py-2.5 ${otpBusy || phone.trim().length < 10 ? "opacity-50" : ""}`}
                  >
                    <Text className="font-semibold text-[13.5px] text-brand-blue-lift">
                      {otpBusy ? "Sending…" : "Send verification code"}
                    </Text>
                  </Pressable>
                </>
              )}

              <Text className={labelCls}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="dave@smithheating.co.uk"
                placeholderTextColor="#6E86A3"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                className={inputCls}
              />
              <Text className="mt-1.5 font-sans text-xs text-night-muted">
                Your sign-in and where plan documents are sent.
              </Text>

              {claim?.valid && claim.personalised ? (
                <View className="mt-3 rounded-[10px] border border-flame-tint bg-flame-tint px-3.5 py-2.5">
                  <Text className="font-semibold text-[13px] text-flame">
                    Claiming the account reserved for {claim.businessName}
                  </Text>
                </View>
              ) : (
                <>
              <Text className={labelCls}>How did you hear about us?</Text>
              <View className="flex-row flex-wrap gap-2">
                {HEARD_OPTIONS.map((o) => (
                  <Pressable
                    key={o.value}
                    onPress={() => setHeardVia(o.value)}
                    className={`rounded-full border-[1.5px] px-3.5 py-2 ${heardVia === o.value ? "border-brand-blue bg-flame-tint" : "border-line"}`}
                  >
                    <Text className="font-sans text-[13px] text-night-text">{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              {heardVia === "engineer" && (
                <>
                  <Text className={labelCls}>Referral code (optional)</Text>
                  <TextInput
                    value={referralCode}
                    onChangeText={setReferralCode}
                    placeholder="e.g. dave-smith"
                    placeholderTextColor="#6E86A3"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className={inputCls}
                  />
                </>
              )}
                </>
              )}
            </View>

            <Pressable
              onPress={() => setStep(2)}
              disabled={!step1Valid}
              className={`mt-4 items-center rounded-xl bg-white py-3.5 ${step1Valid ? "" : "opacity-50"}`}
            >
              <Text className="font-bold text-[16.5px] text-on-light">Continue</Text>
            </Pressable>
            <Link href="/sign-in" asChild>
              <Pressable className="mt-3">
                <Text className="text-center font-sans text-sm text-night-muted">
                  Already have an account? <Text className="text-brand-blue-lift">Sign in</Text>
                </Text>
              </Pressable>
            </Link>
          </>
        )}

        {step === 2 && (
          <>
            <Text className="font-bold text-[28px] text-night-text uppercase tracking-wide">
              Verify your trade
            </Text>
            <Text className="mb-2 font-sans text-[14.5px] text-night-muted">
              Customers see your verified badge on every plan you sell — it&apos;s your biggest
              closer.
            </Text>

            <View className="rounded-[14px] border border-line bg-night-card p-4">
              <Text className={`${labelCls} mt-0`}>Your trade</Text>
              <View className="rounded-[10px] border-[1.5px] border-brand-blue bg-night-card px-3 py-2.5">
                <Text className="font-sans text-sm text-night-text">✓ Gas / Heating</Text>
              </View>
              <View className="mt-2 flex-row flex-wrap gap-2">
                {OTHER_TRADES.map((t) => {
                  const on = interestTrades.has(t.code);
                  return (
                    <Pressable
                      key={t.code}
                      onPress={() => toggleInterest(t.code)}
                      className={`flex-[1_1_47%] flex-row items-center gap-1.5 rounded-[10px] border-[1.5px] px-3 py-2.5 ${on ? "border-brand-blue" : "border-line"}`}
                    >
                      <Text className="font-sans text-[13.5px] text-night-text">{t.name}</Text>
                      <Text className="ml-auto font-mono text-[8.5px] text-night-muted">SOON</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text className="mt-2 font-sans text-xs text-night-muted">
                More trades launching soon — ticking one registers your interest.
              </Text>

              <Text className={labelCls}>Gas Safe registration number</Text>
              <TextInput
                value={gasSafeNo}
                onChangeText={(v) => {
                  setGasSafeNo(v);
                  setGasSafeMatch(null);
                  setGasChecked(false);
                  setGasReviewPending(false);
                  setGasError(null);
                }}
                placeholder="584123"
                placeholderTextColor="#6E86A3"
                keyboardType="number-pad"
                className={inputCls}
              />
              {gasSafeMatch ? (
                <View className="mt-2.5 flex-row items-start gap-1.5 rounded-[10px] border border-line bg-night-card px-3.5 py-2.5">
                  <Tick credential size={16} />
                  <Text className="shrink font-semibold text-[13px] text-night-text">
                    Verified against the register — {gasSafeMatch.name} · {gasSafeMatch.company} ·{" "}
                    {gasSafeMatch.categories}
                  </Text>
                </View>
              ) : gasReviewPending ? (
                <View className="mt-2.5 rounded-[10px] border border-line bg-night-card px-3.5 py-2.5">
                  <Text className="font-semibold text-[13px] text-night-text">
                    Continuing without a match — we&apos;ll verify {gasSafeNo} manually before your
                    plans go live.
                  </Text>
                </View>
              ) : gasChecked && !gasBusy ? (
                // review #11 — amber, never a dead end: offer a manual-review
                // escape hatch instead of blocking sign-up on a register miss
                // (a real mismatch, or the check itself failing to complete).
                <View className="mt-2.5 rounded-[10px] border border-warn-tint bg-warn-tint px-3.5 py-2.5">
                  <Text className="font-semibold text-[13px] text-warn">
                    {gasError ?? "No match on the register."}
                  </Text>
                  <Text className="mt-1 font-sans text-xs text-night-muted">
                    Double check the number, or continue and we&apos;ll verify it manually.
                  </Text>
                  <View className="mt-2.5 flex-row gap-2">
                    <Pressable
                      onPress={checkGasSafe}
                      disabled={gasSafeNo.trim().length < 6}
                      className="flex-1 items-center rounded-[10px] border-[1.5px] border-brand-blue py-2.5"
                    >
                      <Text className="font-semibold text-[13px] text-brand-blue-lift">Try again</Text>
                    </Pressable>
                    <Pressable
                      onPress={continueWithoutMatch}
                      className="flex-1 items-center rounded-[10px] border-[1.5px] border-line py-2.5"
                    >
                      <Text className="font-semibold text-[13px] text-night-text">Continue anyway</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable
                  onPress={checkGasSafe}
                  disabled={gasBusy || gasSafeNo.trim().length < 6}
                  className={`mt-2.5 items-center rounded-[10px] border-[1.5px] border-brand-blue py-2.5 ${gasBusy || gasSafeNo.trim().length < 6 ? "opacity-50" : ""}`}
                >
                  <Text className="font-semibold text-[13.5px] text-brand-blue-lift">
                    {gasBusy ? "Checking…" : "Check the register"}
                  </Text>
                </Pressable>
              )}
            </View>

            <Pressable
              onPress={() => setStep(3)}
              disabled={!step2Valid}
              className={`mt-4 items-center rounded-xl bg-white py-3.5 ${step2Valid ? "" : "opacity-50"}`}
            >
              <Text className="font-bold text-[16.5px] text-on-light">Continue</Text>
            </Pressable>
            <Pressable onPress={() => setStep(1)} className="mt-3">
              <Text className="text-center font-sans text-sm text-night-muted">← Back</Text>
            </Pressable>
          </>
        )}

        {step === 3 && (
          <>
            <Text className="font-bold text-[28px] text-night-text uppercase tracking-wide">
              Your business
            </Text>
            <Text className="mb-2 font-sans text-[14.5px] text-night-muted">
              This is the name your customers see on their plan.
            </Text>

            <View className="rounded-[14px] border border-line bg-night-card p-4">
              <Text className={`${labelCls} mt-0`}>Trading name</Text>
              <TextInput
                value={tradingName}
                onChangeText={setTradingName}
                placeholder="Smith Heating"
                placeholderTextColor="#6E86A3"
                className={inputCls}
              />
              {tradingName ? (
                <Text className="mt-1.5 font-sans text-xs text-night-muted">
                  Plan brand preview: &ldquo;{tradingName} Care Plans&rdquo;
                </Text>
              ) : null}

              <Text className={labelCls}>Business type</Text>
              <View className="flex-row gap-2">
                {(
                  [
                    ["sole_trader", "Sole trader"],
                    ["ltd", "Limited company"],
                    ["partnership", "Partnership"],
                  ] as const
                ).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => setBusinessType(value)}
                    className={`flex-1 items-center rounded-[10px] border-[1.5px] px-2 py-2.5 ${businessType === value ? "border-brand-blue" : "border-line"}`}
                  >
                    <Text className="font-sans text-[12.5px] text-night-text">{label}</Text>
                  </Pressable>
                ))}
              </View>

              {businessType === "ltd" && (
                <>
                  <Text className={labelCls}>Company number (optional)</Text>
                  <TextInput
                    value={companyNumber}
                    onChangeText={setCompanyNumber}
                    placeholder="12345678"
                    placeholderTextColor="#6E86A3"
                    className={inputCls}
                  />
                </>
              )}

              <Text className={labelCls}>Business postcode</Text>
              <TextInput
                value={postcode}
                onChangeText={setPostcode}
                placeholder="HD9 2TT"
                placeholderTextColor="#6E86A3"
                autoCapitalize="characters"
                className={inputCls}
              />
              <Text className="mt-1.5 font-sans text-xs text-night-muted">
                So we know your patch — customers aren&apos;t shown this.
              </Text>

              <Pressable
                onPress={() => setTermsConsent(!termsConsent)}
                className="mt-4 flex-row items-start gap-2.5"
              >
                <View
                  className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${termsConsent ? "border-brand-blue bg-brand-blue" : "border-line"}`}
                >
                  {termsConsent && <Text className="text-[11px] text-white">✓</Text>}
                </View>
                <Text className="flex-1 font-sans text-[13px] text-night-muted">
                  I agree to the Terms of Service and Privacy Policy
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMarketingConsent(!marketingConsent)}
                className="mt-2.5 flex-row items-start gap-2.5"
              >
                <View
                  className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${marketingConsent ? "border-brand-blue bg-brand-blue" : "border-line"}`}
                >
                  {marketingConsent && <Text className="text-[11px] text-white">✓</Text>}
                </View>
                <Text className="flex-1 font-sans text-[13px] text-night-muted">
                  Send me tips and product updates (optional)
                </Text>
              </Pressable>
            </View>

            {error && <Text className="mt-2 font-sans text-sm text-danger">{error}</Text>}
            {duplicateGasSafe && (
              <Link href="/sign-in" asChild>
                <Pressable className="mt-1">
                  <Text className="font-sans text-sm text-brand-blue-lift underline">
                    Sign in instead
                  </Text>
                </Pressable>
              </Link>
            )}
            <Pressable
              onPress={submit}
              disabled={busy || !step3Valid}
              className={`mt-4 items-center rounded-xl bg-white py-3.5 ${busy || !step3Valid ? "opacity-50" : ""}`}
            >
              {busy ? (
                <ActivityIndicator color="#0F2140" />
              ) : (
                <Text className="font-bold text-[16.5px] text-on-light">Create my account</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setStep(2)} className="mt-3">
              <Text className="text-center font-sans text-sm text-night-muted">← Back</Text>
            </Pressable>
          </>
        )}

        <Text className="mt-5 text-center font-mono text-[10px] tracking-wide text-night-muted">
          GAS SAFE VERIFIED MEMBERS · PAYOUTS DIRECT TO YOUR BANK · NO CARD REQUIRED
        </Text>
      </ScrollView>
      </SafeAreaView>
    </View>
  );
}
