import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { useAuth } from "@/lib/auth-context";
import { Lockup } from "@/components/ui";

// 4 Oct build notes, section 2.2 — stay signed in + Face ID. The sign-in
// code is only needed on a new device or after sign-out; reopening the app
// asks for Face ID (or Touch ID / the phone passcode) instead. Phones with
// no biometrics or passcode set up just open, as before.
const RELOCK_AFTER_MS = 5 * 60 * 1000;

async function biometricsReady(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const [hardware, enrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hardware && enrolled;
}

export function FaceIdGate() {
  const { token, loading, signOut } = useAuth();
  const [locked, setLocked] = useState(false);
  const [failed, setFailed] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    setFailed(false);
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock TradeSura",
      fallbackLabel: "Use passcode",
    });
    if (result.success) setLocked(false);
    else setFailed(true);
  }, []);

  // Locks only once the phone confirms Face ID / passcode is set up.
  const lockIfAvailable = useCallback(() => {
    biometricsReady().then((ready) => {
      if (!ready) return;
      setLocked(true);
      unlock();
    });
  }, [unlock]);

  // Once, on launch, if the app opens with a saved session — never straight
  // after a fresh code sign-in in the same run.
  const launchChecked = useRef(false);
  useEffect(() => {
    if (loading || launchChecked.current) return;
    launchChecked.current = true;
    if (token) lockIfAvailable();
  }, [loading, token, lockIfAvailable]);

  // Coming back after a while in the background.
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") backgroundedAt.current = Date.now();
      if (state === "active" && backgroundedAt.current) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away > RELOCK_AFTER_MS) lockIfAvailable();
      }
    });
    return () => sub.remove();
  }, [token, lockIfAvailable]);

  if (!locked || !token) return null;


  return (
    <View style={StyleSheet.absoluteFill} className="items-center justify-center gap-6 bg-night px-8">
      <Lockup height={52} />
      <Text className="text-center text-[16px] text-white/85">
        {failed ? "That didn't unlock TradeSura." : "Unlock with Face ID to carry on."}
      </Text>
      <Pressable onPress={unlock} className="w-full items-center rounded-xl bg-white py-3.5">
        <Text className="font-semibold text-on-light">Unlock</Text>
      </Pressable>
      {/* The way out if Face ID won't work — the 6-digit code signs back in. */}
      <Pressable onPress={signOut} hitSlop={8}>
        <Text className="text-[14px] text-white/60">Sign out and use a code instead</Text>
      </Pressable>
    </View>
  );
}
