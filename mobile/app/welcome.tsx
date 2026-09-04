import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Animated, AccessibilityInfo, AppState } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import { SafeAreaView } from "react-native-safe-area-context";
import { api, getHasSignedInBefore } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

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
  } = useLocalSearchParams<{ code?: string; ref?: string; name?: string }>();

  const [claim, setClaim] = useState<ClaimResolved | null>(null);
  const [returning, setReturning] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const dismissedFired = useRef(false);
  const acted = useRef(false);

  // Safety net: a signed-in engineer who lands here via a stale deep link
  // (an old claim/referral link tapped after already signing up) skips
  // straight through, same as if he'd never seen this screen.
  useEffect(() => {
    if (token) router.replace("/(tabs)");
  }, [token]);

  useEffect(() => {
    getHasSignedInBefore().then(setReturning);
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
  // (No background scale-loop: that animated a gradient/photo that isn't
  // there — see the flat background note below.)
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
      params: { ...(code ? { code } : {}), ...(refParam ? { ref: refParam } : {}) },
    });
  }

  function goSignIn() {
    acted.current = true;
    fire("welcome_signin_tapped", { source });
    router.push("/sign-in");
  }

  return (
    // Flat navy background, not the gradient/scale-loop the spec describes —
    // expo-linear-gradient needs a native rebuild this binary doesn't have
    // yet (see components/ui.tsx's Card for the same note). Revisit once a
    // fresh build exists.
    <View className="flex-1 bg-bg">
      <SafeAreaView edges={["top", "bottom"]} className="flex-1 justify-between px-6 pb-6 pt-10">
        <Animated.View style={fadeRise(brandAnim)}>
          <Text className="font-mono text-[11px] font-medium uppercase tracking-[3px] text-brand-blue-lift">
            Care plan platform
          </Text>
          <Text className="mt-2 text-[40px] font-extrabold leading-none tracking-tight text-white">
            TRADE<Text className="text-flame">SURA</Text>
            <Text className="text-copper">✓</Text>
          </Text>
          <Text className="mt-2 text-[13.5px] tracking-wide text-night-muted">
            Your trade. On plan.
          </Text>
        </Animated.View>

        <Animated.View style={fadeRise(heroAnim)} className="mt-8">
          {personalisedName ? (
            <>
              <Text className="text-[30px] font-extrabold leading-[1.12] tracking-tight text-white">
                Welcome, {personalisedName} — your free account is reserved.
              </Text>
              <Text className="mt-3.5 text-[15px] leading-5 text-night-muted">
                {reservedFor ? `Reserved for ${reservedFor}. ` : ""}Claim it in about 2 minutes.
              </Text>
            </>
          ) : (
            <>
              <Text className="text-[30px] font-extrabold leading-[1.12] tracking-tight text-white">
                Your customers,{"\n"}paying you <Text className="text-copper">every month.</Text>
              </Text>
              <Text className="mt-3.5 text-[15px] leading-5 text-night-muted">
                Sell your own care plans at the end of the job. We collect the Direct Debit, you
                keep 80%, paid every Friday.
                {referrerName ? `\n\n${referrerName} recommended TradeSura.` : ""}
              </Text>
            </>
          )}
        </Animated.View>

        <Animated.View style={fadeRise(proofAnim)} className="mt-6 flex-row gap-2">
          {[
            ["Free", "account"],
            ["80%", "you keep"],
            ["Fridays", "paid out"],
          ].map(([big, small]) => (
            <View
              key={big}
              className="flex-1 items-center rounded-[10px] border border-line bg-white/[0.07] py-2.5"
            >
              <Text className="text-[15px] font-bold text-white">{big}</Text>
              <Text className="font-mono text-[10px] uppercase tracking-wide text-night-muted">
                {small}
              </Text>
            </View>
          ))}
        </Animated.View>

        <Animated.View style={fadeRise(ctaAnim)} className="mt-8">
          {returning && !personalisedName ? (
            <>
              <Pressable
                onPress={goSignIn}
                className="min-h-[56px] items-center justify-center rounded-2xl bg-white"
              >
                <Text className="text-base font-extrabold text-on-light">Sign in</Text>
              </Pressable>
              <Pressable
                onPress={startPrimary}
                className="mt-2.5 min-h-11 items-center justify-center rounded-2xl border-[1.5px] border-white/55 py-3.5"
              >
                <Text className="font-semibold text-white">Create a new account</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={startPrimary}
                className="min-h-[56px] items-center justify-center rounded-2xl bg-white"
              >
                <Text className="text-base font-extrabold text-on-light">
                  {personalisedName ? "Claim my free account" : "Start now — it's free"}
                </Text>
              </Pressable>
              <Pressable
                onPress={goSignIn}
                className="mt-2.5 min-h-11 items-center justify-center rounded-2xl border-[1.5px] border-white/55 py-3.5"
              >
                <Text className="font-semibold text-white">I already have an account</Text>
              </Pressable>
            </>
          )}
          <Text className="mt-3.5 text-center font-mono text-[10.5px] uppercase tracking-wide text-night-muted">
            Gas Safe verified members · No card required
          </Text>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}
