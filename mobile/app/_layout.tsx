import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LaunchOverlay } from "@/components/ring-loader";

// Ready once we know who's signed in and (if anyone is) their profile has
// loaded or failed — the moment the first real screen can render.
function Launch() {
  const { loading, token, me, meError } = useAuth();
  return <LaunchOverlay ready={!loading && (!token || Boolean(me) || Boolean(meError))} />;
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
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="first-payout" />
      </Stack>
        <Launch />
      </View>
    </AuthProvider>
  );
}
