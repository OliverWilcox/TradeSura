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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="onboarding" />
      </Stack>
    </AuthProvider>
  );
}
