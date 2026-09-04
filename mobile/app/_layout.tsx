import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "@/lib/auth-context";

// Build Spec v1 §1: system font only — no custom webfonts. Weight comes from
// the font-{medium,semibold,bold} utilities; `font-mono` falls back to the
// platform monospace face (see tailwind.config.js).
// Screen Designs v2: "prefer dark" status bar everywhere, no light variant.
export default function RootLayout() {
  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}
