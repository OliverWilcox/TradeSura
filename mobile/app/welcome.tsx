import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Animated,
  AccessibilityInfo,
  AppState,
  ScrollView,
} from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Lockup } from "@/components/ui";
import { AuthBackdrop } from "@/components/auth-backdrop";
import { Icon } from "@/components/icon";
import { PoweredByStripe } from "@/components/stripe-badge";
import { EXAMPLE_CUSTOMERS, formatPounds, yearlyPence } from "@/lib/earnings";

type ClaimResolved =
  | { valid: true; personalised: boolean; firstName?: string; businessName?: string }
  | { valid: false };

function fire(event: string, meta?: Record<string, unknown>) {
  api("/api/telemetry/welcome", { method: "POST", body: JSON.stringify({ event, meta }) }).catch(
    () => {
      // best-effort — telemetry never blocks the screen
    },
  );
}

function prettifySlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// W0 — the first screen a signed-out engineer sees. One message, one primary
// action: get him to Start now within five seconds. Shown once per launch,
// never to a signed-in engineer (see (tabs)/_layout.tsx's redirect, and the
// safety-net check below for anyone who deep-links here while already
// signed in). Language law: never insurance/cover/protection/warranty/
// doorstep — "care plans", "at the end of the job", "you keep 80%".
export default function Welcome() {
  const { token } = useAuth();
  const {
    code,
    ref: refParam,
    name: referrerNameParam,
    src,
  } = useLocalSearchParams<{ code?: string; ref?: string; name?: string; src?: string }>();

  const [claim, setClaim] = useState<ClaimResolved | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  const dismissedFired = useRef(false);
  const acted = useRef(false);

  // Safety net: a signed-in engineer who lands here via a stale deep link
  // (an old claim/referral link tapped after already signing up) skips
  // straight through, same as if he'd never seen this screen.
  // Focus-scoped: this screen stays mounted under sign-up in the stack, and
  // an unscoped effect fired the moment signup signed in — replacing the
  // "Building your account" → Getting Started hub hand-off with the bare
  // dashboard (29 Sept review: "the onboarding wizard doesn't fire").
  useFocusEffect(
    useCallback(() => {
      if (token) router.replace("/");
    }, [token]),
  );

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    api<ClaimResolved>(`/api/claim/resolve?code=${encodeURIComponent(code)}`)
      .then((r) => {
        if (!cancelled) setClaim(r);
      })
      .catch(() => {
        // Not a dead end — falls through to the generic screen.
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const source = claim?.valid && claim.personalised ? "claim" : refParam ? "referral" : "organic";

  useEffect(() => {
    // Fires once we know whether a claim code resolved (or immediately for
    // organic/referral) — not before, so "source" is accurate.
    if (code && claim === null) return;
    fire("welcome_viewed", { source });
  }, [code, claim, source]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" && !acted.current && !dismissedFired.current) {
        dismissedFired.current = true;
        fire("welcome_dismissed", { source });
      }
    });
    return () => sub.remove();
  }, [source]);

  // ---- motion --------------------------------------------------------
  // useState initializer (not useRef().current) — same "stable mutable
  // container" idiom, but doesn't trip the react-hooks/refs rule, which
  // treats any .current read outside an effect/handler as unsafe.
  const [brandAnim] = useState(() => new Animated.Value(0));
  const [heroAnim] = useState(() => new Animated.Value(0));
  const [proofAnim] = useState(() => new Animated.Value(0));
  const [ctaAnim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reduceMotion) {
      [brandAnim, heroAnim, proofAnim, ctaAnim].forEach((v) => v.setValue(1));
      return;
    }
    const stagger = [brandAnim, heroAnim, proofAnim, ctaAnim].map((v) =>
      Animated.timing(v, { toValue: 1, duration: 260, useNativeDriver: true }),
    );
    Animated.stagger(80, stagger).start();
  }, [reduceMotion, brandAnim, heroAnim, proofAnim, ctaAnim]);

  const fadeRise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  });

  // ---- content ---------------------------------------------------------
  const personalisedName =
    claim?.valid && claim.personalised && claim.firstName ? claim.firstName : null;
  const reservedFor = claim?.valid && claim.personalised ? claim.businessName : null;
  const referrerName = referrerNameParam || (refParam ? prettifySlug(refParam) : null);

  function startPrimary() {
    acted.current = true;
    if (!reduceMotion) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    fire("welcome_start_tapped", { source });
    router.push({
      pathname: "/sign-up",
      params: {
        ...(code ? { code } : {}),
        ...(refParam ? { ref: refParam } : {}),
        // e.g. ?src=email on a campaign link — sign-up records it and skips
        // "How did you hear about us?".
        ...(src ? { src } : {}),
      },
    });
  }

  function goSignIn() {
    acted.current = true;
    fire("welcome_signin_tapped", { source });
    router.push("/sign-in");
  }

  return (
    <View className="flex-1 bg-night">
      <AuthBackdrop fadeToNavy />
      <SafeAreaView edges={["top", "bottom"]} className="flex-1">
        {/* Fit the guide's compact copy at default text size. Keep scrolling
            available for small screens and larger accessibility text. */}
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8 }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Animated.View style={fadeRise(brandAnim)}>
            <Text className="tabular-nums text-[10px] font-bold uppercase tracking-[3px] text-brand-blue-lift">
              Care plan platform
            </Text>
            <View className="mt-2.5">
              <Lockup height={52} />
            </View>
            {/* 4 Oct notes 3.2 — white, it was getting lost in grey. */}
            <Text className="mt-2 text-[14px] font-medium text-white">
              Your trade. On plan.
            </Text>
          </Animated.View>

          <View style={{ flexGrow: 1, flexShrink: 0, justifyContent: "center", paddingVertical: 16 }}>
          <Animated.View style={fadeRise(heroAnim)}>
            {personalisedName ? (
              <>
                <Text className="text-[25px] font-extrabold leading-[30px] tracking-tight text-white">
                  Welcome, {personalisedName} — your free account is reserved.
                </Text>
                <Text className="mt-3 text-[15px] leading-[21px] text-white/85">
                  {reservedFor ? `Reserved for ${reservedFor}. ` : ""}Claim it in about 2 minutes.
                </Text>
              </>
            ) : (
              <>
                {/* Green is money-only (Part 2.1) — "every month" is the money
                    promise here, same accent as the £9.60 keep-line below. */}
                {/* 4 Oct notes 3.1 — the green words a clear step up (≈54 vs 48). */}
                <Text className="text-[27px] font-extrabold leading-[33px] tracking-tight text-white">
                  Your customers,{"\n"}paying you{" "}
                  <Text className="text-[30px] text-copper">every month.</Text>
                </Text>
                <Text className="mt-3 text-[15px] leading-[21px] text-white/85">
                  Sell your own care plans at the end of the job. We collect the Direct Debit, you
                  keep 80%, paid every Friday.
                  {referrerName ? `\n\n${referrerName} recommended TradeSura.` : ""}
                </Text>
                {/* 4 Oct notes 3.4 — the figure comes from lib/earnings.ts
                    (a config value), never a typed string. */}
                <View className="mt-3">
                  <Text className="text-[13px] font-medium text-white/85">What you could earn:</Text>
                  <Text className="mt-0.5 text-[16px] font-semibold text-white">
                    Just {EXAMPLE_CUSTOMERS} customers ={" "}
                    <Text className="font-bold text-copper">
                      {formatPounds(yearlyPence(EXAMPLE_CUSTOMERS))}
                    </Text>{" "}
                    a year
                  </Text>
                  <Text className="mt-0.5 text-[10px] text-white/50">
                    *based on average installer care plan prices
                  </Text>
                </View>
                {/* 3.6 */}
                <View className="mt-3 flex-row items-start gap-1.5">
                  <Icon name="importBook" size={12} color="#5FA3F0" weight="semibold" />
                  <Text className="shrink text-[12.5px] leading-[18px] text-white/85">
                    <Text className="font-semibold text-white">Already got customers?</Text> Import
                    your book and offer them all in one tap.
                  </Text>
                </View>
              </>
            )}
          </Animated.View>

          </View>

          {/* 4 Oct notes 3.7 — a real (ghost) button, above the proof chips. */}
          <Pressable
            onPress={() => router.push("/how-it-works")}
            className="mb-2.5 min-h-11 flex-row items-center justify-center gap-2 rounded-2xl border-[1.5px] border-white/40 py-3"
            accessibilityRole="button"
          >
            <Icon name="info" size={16} color="#ffffff" weight="semibold" />
            <Text className="text-[14px] font-semibold text-white">See how it works</Text>
          </Pressable>

          <Animated.View style={[fadeRise(proofAnim), { flexDirection: "row", gap: 10, marginBottom: 12 }]}>
            {[
              ["Free", "account"],
              ["80%", "you keep"],
              ["Fridays", "paid out"],
            ].map(([big, small]) => (
              <View
                key={big}
                className="flex-1 items-center rounded-xl border border-white/15 bg-white/[0.08] py-2.5"
              >
                <Text className="text-[15px] font-bold text-white">{big}</Text>
                <Text className="mt-0.5 tabular-nums text-[11px] uppercase tracking-wider text-night-muted">
                  {small}
                </Text>
              </View>
            ))}
          </Animated.View>

          <Animated.View style={fadeRise(ctaAnim)}>
            {/* 29 Sept review — primary is always "Start now", never swapped
                for returning devices; signing in is the secondary. */}
            <Pressable
              onPress={startPrimary}
              className="mt-1.5 min-h-[56px] items-center justify-center rounded-2xl bg-white"
            >
              <Text className="text-[16px] font-bold text-on-light">
                {personalisedName ? "Claim my free account" : "Start now — it's free"}
              </Text>
            </Pressable>
            {/* Not green — green is money only (Part 2.1). */}
            <Text className="mt-1.5 text-center text-[10px] text-white/75">
              Takes 2 minutes · No card required
            </Text>
            <Pressable
              onPress={goSignIn}
              className="mt-2.5 min-h-11 items-center justify-center rounded-2xl border-[1.5px] border-white/55 py-3.5"
            >
              <Text className="text-[14px] font-semibold text-white">I already have an account</Text>
            </Pressable>
            <Text className="mt-3 text-center tabular-nums text-[11px] uppercase tracking-wider text-night-muted">
              Gas Safe verified members
            </Text>
            {/* Build Review 3 §3 — the official badge, never typed text.
                Outline-only white vector (not the boxed pill), so it still
                doesn't read as a third button (4 Oct notes 3.10). */}
            <View className="mb-1 mt-2 items-center opacity-80">
              <PoweredByStripe width={92} />
            </View>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
