import { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, Linking } from "react-native";
import { Link } from "expo-router";
import { api, ApiError } from "@/lib/api";

type Verified = { regNo: string; name: string; company: string; categories: string };
type BusinessType = "sole_trader" | "ltd" | "partnership";

// Hand-duplicated from ../../lib/trades.ts — Metro's watchFolders keeps this
// app's resolution scoped to mobile/ (see mobile/CLAUDE.md), same reason
// tier/[tierId].tsx duplicates small display constants rather than importing
// cross-repo. Only display names/codes here; the compliance-relevant lookup
// itself (verifyGasSafe) stays server-side via /api/verify.
const OTHER_TRADES = [
  { code: "HEAT_PUMP", name: "Heat Pump" },
  { code: "ELECTRICAL", name: "Electrical" },
  { code: "OIL", name: "Oil (OFTEC)" },
  { code: "SOLAR", name: "Solar" },
  { code: "AIRCON", name: "Air Con" },
] as const;

const inputCls =
  "rounded-[10px] border border-[#26303C] bg-night-card px-3.5 py-3 font-sans text-[15px] text-night-text";
const labelCls = "mb-1.5 mt-3.5 font-sans-semibold text-[13px] text-night-muted";

export default function SignUp() {
  const [step, setStep] = useState<1 | 2 | 3>(1);

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

  // Step 2 — trade + Gas Safe
  const [interestTrades, setInterestTrades] = useState<Set<string>>(new Set());
  const [gasSafeNo, setGasSafeNo] = useState("");
  const [gasSafeMatch, setGasSafeMatch] = useState<Verified | null>(null);
  const [gasBusy, setGasBusy] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);

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
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);

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
    try {
      const data = await api<Verified>("/api/verify", {
        method: "POST",
        body: JSON.stringify({ regNo: gasSafeNo }),
      });
      setGasSafeMatch(data);
      if (!tradingName) setTradingName(data.company);
    } catch (e) {
      setGasSafeMatch(null);
      setGasError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setGasBusy(false);
    }
  }

  function toggleInterest(code: string) {
    const next = new Set(interestTrades);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setInterestTrades(next);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const data = await api<{ ok: boolean; devLink?: string }>("/api/auth/request", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          signup: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            phoneToken,
            trades: [...interestTrades],
            gasSafeNo: gasSafeMatch?.regNo,
            gasSafeName: gasSafeMatch?.name,
            gasSafeCompany: gasSafeMatch?.company,
            gasSafeCategories: gasSafeMatch?.categories,
            tradingName: tradingName.trim(),
            businessType,
            companyNumber: businessType === "ltd" ? companyNumber.trim() || undefined : undefined,
            postcode: postcode.trim().toUpperCase(),
            marketingConsent,
          },
        }),
      });
      setSent(true);
      setDevLink(data.devLink ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const step1Valid =
    firstName.trim().length >= 2 && lastName.trim().length >= 2 && Boolean(phoneToken) && email.includes("@");
  const step2Valid = Boolean(gasSafeMatch);
  const step3Valid =
    tradingName.trim().length >= 2 && postcode.trim().length >= 4 && termsConsent;

  if (sent) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-night px-6">
        <Text className="font-disp-bold text-3xl text-night-text uppercase tracking-wide">
          TradeSura
        </Text>
        <Text className="font-sans-semibold text-night-text">Check your email</Text>
        <Text className="text-center font-sans text-sm text-night-muted">
          We&apos;ve sent a link to <Text className="text-night-text">{email}</Text> to finish
          creating your account. It&apos;s valid for 15 minutes.
        </Text>
        {devLink && (
          <Pressable onPress={() => Linking.openURL(devLink)}>
            <Text className="text-center font-mono text-xs text-brand-blue-lift underline">
              DEV: open sign-up link
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-night">
      <ScrollView className="flex-1" contentContainerClassName="px-6 pb-10 pt-14 gap-1">
        <View className="mb-3.5 flex-row items-center justify-between">
          <Text className="font-disp-bold text-[22px] text-night-text uppercase tracking-wide">
            Trade<Text className="text-brand-blue-lift">Sura</Text>
          </Text>
          <Text className="font-mono-medium text-[11px] tracking-widest text-night-muted">
            STEP {step} OF 3
          </Text>
        </View>
        <View className="mb-5 h-[5px] overflow-hidden rounded-full bg-[#26303C]">
          <View className="h-full rounded-full bg-brand-blue" style={{ width: `${(step / 3) * 100}%` }} />
        </View>

        {step === 1 && (
          <>
            <Text className="font-disp-bold text-[28px] text-night-text uppercase tracking-wide">
              Create your account
            </Text>
            <Text className="mb-2 font-sans text-[14.5px] text-night-muted">
              Takes about 2 minutes. No card needed.
            </Text>

            <View className="rounded-[14px] border border-[#26303C] bg-night-card p-4">
              <View className="flex-row gap-2.5">
                <View className="flex-1">
                  <Text className={labelCls}>First name</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="Dave"
                    placeholderTextColor="#5E6975"
                    className={inputCls}
                  />
                </View>
                <View className="flex-1">
                  <Text className={labelCls}>Last name</Text>
                  <TextInput
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Smith"
                    placeholderTextColor="#5E6975"
                    className={inputCls}
                  />
                </View>
              </View>

              <Text className={labelCls}>Mobile number</Text>
              <TextInput
                value={phone}
                onChangeText={onPhoneChange}
                placeholder="07123 456789"
                placeholderTextColor="#5E6975"
                keyboardType="phone-pad"
                editable={!phoneToken}
                className={inputCls}
              />
              <Text className="mt-1.5 font-sans text-xs text-night-muted">
                We text your customers&apos; signup links from the app — and verify this number by
                code.
              </Text>

              {phoneToken ? (
                <View className="mt-2.5 rounded-[10px] border border-[#1E4633] bg-[#12291E] px-3.5 py-2.5">
                  <Text className="font-sans-semibold text-[13.5px] text-[#2BB673]">
                    ✓ Mobile verified
                  </Text>
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
                    placeholderTextColor="#5E6975"
                    keyboardType="number-pad"
                    className={inputCls}
                  />
                  {otpError && <Text className="font-sans text-[13px] text-danger">{otpError}</Text>}
                  <Pressable
                    onPress={verifyOtp}
                    disabled={otpBusy || otpCode.length < 4}
                    className={`items-center rounded-[10px] border-[1.5px] border-brand-blue py-2.5 ${otpBusy || otpCode.length < 4 ? "opacity-50" : ""}`}
                  >
                    <Text className="font-sans-semibold text-[13.5px] text-brand-blue-lift">
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
                    <Text className="font-sans-semibold text-[13.5px] text-brand-blue-lift">
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
                placeholderTextColor="#5E6975"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                className={inputCls}
              />
              <Text className="mt-1.5 font-sans text-xs text-night-muted">
                Your sign-in and where plan documents are sent.
              </Text>
            </View>

            <Pressable
              onPress={() => setStep(2)}
              disabled={!step1Valid}
              className={`mt-4 items-center rounded-xl bg-brand-blue py-3.5 ${step1Valid ? "" : "opacity-50"}`}
            >
              <Text className="font-sans-bold text-[16.5px] text-white">Continue</Text>
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
            <Text className="font-disp-bold text-[28px] text-night-text uppercase tracking-wide">
              Verify your trade
            </Text>
            <Text className="mb-2 font-sans text-[14.5px] text-night-muted">
              Customers see your verified badge on every plan you sell — it&apos;s your biggest
              closer.
            </Text>

            <View className="rounded-[14px] border border-[#26303C] bg-night-card p-4">
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
                      className={`flex-[1_1_47%] flex-row items-center gap-1.5 rounded-[10px] border-[1.5px] px-3 py-2.5 ${on ? "border-brand-blue" : "border-[#26303C]"}`}
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
                }}
                placeholder="584123"
                placeholderTextColor="#5E6975"
                keyboardType="number-pad"
                className={inputCls}
              />
              {gasSafeMatch ? (
                <View className="mt-2.5 rounded-[10px] border border-[#1E4633] bg-[#12291E] px-3.5 py-2.5">
                  <Text className="font-sans-semibold text-[13px] text-[#2BB673]">
                    ✓ Verified against the register — {gasSafeMatch.name} · {gasSafeMatch.company} ·{" "}
                    {gasSafeMatch.categories}
                  </Text>
                </View>
              ) : (
                <>
                  {gasError && <Text className="mt-2 font-sans text-[13px] text-danger">{gasError}</Text>}
                  <Pressable
                    onPress={checkGasSafe}
                    disabled={gasBusy || gasSafeNo.trim().length < 6}
                    className={`mt-2.5 items-center rounded-[10px] border-[1.5px] border-brand-blue py-2.5 ${gasBusy || gasSafeNo.trim().length < 6 ? "opacity-50" : ""}`}
                  >
                    <Text className="font-sans-semibold text-[13.5px] text-brand-blue-lift">
                      {gasBusy ? "Checking…" : "Check the register"}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>

            <Pressable
              onPress={() => setStep(3)}
              disabled={!step2Valid}
              className={`mt-4 items-center rounded-xl bg-brand-blue py-3.5 ${step2Valid ? "" : "opacity-50"}`}
            >
              <Text className="font-sans-bold text-[16.5px] text-white">Continue</Text>
            </Pressable>
            <Pressable onPress={() => setStep(1)} className="mt-3">
              <Text className="text-center font-sans text-sm text-night-muted">← Back</Text>
            </Pressable>
          </>
        )}

        {step === 3 && (
          <>
            <Text className="font-disp-bold text-[28px] text-night-text uppercase tracking-wide">
              Your business
            </Text>
            <Text className="mb-2 font-sans text-[14.5px] text-night-muted">
              This is the name your customers see on their plan.
            </Text>

            <View className="rounded-[14px] border border-[#26303C] bg-night-card p-4">
              <Text className={`${labelCls} mt-0`}>Trading name</Text>
              <TextInput
                value={tradingName}
                onChangeText={setTradingName}
                placeholder="Smith Heating"
                placeholderTextColor="#5E6975"
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
                    className={`flex-1 items-center rounded-[10px] border-[1.5px] px-2 py-2.5 ${businessType === value ? "border-brand-blue" : "border-[#26303C]"}`}
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
                    placeholderTextColor="#5E6975"
                    className={inputCls}
                  />
                </>
              )}

              <Text className={labelCls}>Business postcode</Text>
              <TextInput
                value={postcode}
                onChangeText={setPostcode}
                placeholder="HD9 2TT"
                placeholderTextColor="#5E6975"
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
                  className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${termsConsent ? "border-brand-blue bg-brand-blue" : "border-[#26303C]"}`}
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
                  className={`mt-0.5 h-[18px] w-[18px] items-center justify-center rounded-[4px] border-[1.5px] ${marketingConsent ? "border-brand-blue bg-brand-blue" : "border-[#26303C]"}`}
                >
                  {marketingConsent && <Text className="text-[11px] text-white">✓</Text>}
                </View>
                <Text className="flex-1 font-sans text-[13px] text-night-muted">
                  Send me tips and product updates (optional)
                </Text>
              </Pressable>
            </View>

            {error && <Text className="mt-2 font-sans text-sm text-danger">{error}</Text>}
            <Pressable
              onPress={submit}
              disabled={busy || !step3Valid}
              className={`mt-4 items-center rounded-xl bg-brand-blue py-3.5 ${busy || !step3Valid ? "opacity-50" : ""}`}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="font-sans-bold text-[16.5px] text-white">Create my account</Text>
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
    </View>
  );
}
