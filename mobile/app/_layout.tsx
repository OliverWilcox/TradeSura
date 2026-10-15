import "../global.css";
import { useEffect, useRef } from "react";
import { Stack, router, type Href } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { FaceIdGate } from "@/components/face-id-gate";
import { LaunchOverlay } from "@/components/ring-loader";

// Ready once we know who's signed in and (if anyone is) their profile has
// loaded or failed — the moment the first real screen can render.
function Launch() {
  const { loading, token, me, meError } = useAuth();
  return <LaunchOverlay ready={!loading && (!token || Boolean(me) || Boolean(meError))} />;
}

// A tapped push opens the screen it's about (the backend puts the route in
// data.url). Covers cold starts too: the last response survives launch, and
// waits here until the engineer's session has loaded. Each notification is
// routed once, so signing out and back in doesn't replay an old tap.
function NotificationTaps() {
  const { token } = useAuth();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!token || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const url = response.notification.request.content.data?.url;
    if (typeof url === "string") router.push(url as Href);
  }, [response, token]);
  return null;
}

// Build Spec v1 §1: system font only — no custom webfonts. Weight comes from
// the font-{medium,semibold,bold} utilities; `font-mono` falls back to the
// platform monospace face (see tailwind.config.js).
// Screen Designs v2: "prefer dark" status bar everywhere, no light variant.
export default function RootLayout() {
  return (
    <AuthProvider>
      <View style={{ flex: 1, backgroundColor: "#0B1A2E" }}>
        <StatusBar style="light" />
      {/* v2: "Screen transitions: fade + 8px rise, 220ms." Native Stack has
          no built-in fade+rise preset, so this uses its closest native
          equivalent (a plain fade) rather than a hand-rolled interpolator —
          untestable without a device, so kept to what the platform already
          knows how to do reliably. */}
      <Stack screenOptions={{ headerShown: false, animation: "fade", animationDuration: 220 }}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        {/* Horizontal card/earnings gestures must not dismiss this screen. */}
        <Stack.Screen name="how-it-works" options={{ gestureEnabled: false }} />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="first-payout" />
      </Stack>
        <Launch />
        <FaceIdGate />
        {Platform.OS !== "web" && <NotificationTaps />}
      </View>
    </AuthProvider>
  );
}
