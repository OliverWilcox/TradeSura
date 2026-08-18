import { useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { View, ActivityIndicator, Text } from "react-native";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

// Target of the deep link the mobile magic-link callback redirects to:
// tradesura://auth-callback?token=...&trades=CODE,CODE (see
// app/api/auth/mobile-callback in the Next.js backend). The trades param only
// appears for a brand-new sign-up with non-gas interest picked in step 2 —
// registering it needs a bearer token, which doesn't exist until signIn()
// below completes, so it can't happen any earlier in the flow.
export default function AuthCallback() {
  const { token, trades, error } = useLocalSearchParams<{
    token?: string;
    trades?: string;
    error?: string;
  }>();
  const { signIn } = useAuth();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (token) {
      signIn(token)
        .then(async () => {
          if (trades) {
            for (const code of trades.split(",")) {
              await api("/api/trades/interest", {
                method: "POST",
                body: JSON.stringify({ code }),
              }).catch(() => {
                // best-effort — a missed interest registration isn't worth blocking signup over
              });
            }
          }
        })
        .then(() => router.replace("/(tabs)"));
    } else {
      router.replace("/sign-in");
    }
  }, [token, trades, signIn]);

  return (
    <View className="flex-1 items-center justify-center gap-3 bg-night">
      <ActivityIndicator color="#0E7FD0" />
      {error && (
        <Text className="font-sans text-sm text-danger">Link expired — try again.</Text>
      )}
    </View>
  );
}
