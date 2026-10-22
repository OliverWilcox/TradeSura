import { useEffect } from "react";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useAuth } from "@/lib/auth-context";
import { CenteredSpinner } from "@/components/skeleton";

// Dev builds only: tradesura://dev-login?token=…&to=/onboarding signs in with
// a session token from scripts/dev-test-engineer.ts and opens a screen, so a
// cloud simulator can be walked without email codes. Release builds
// (__DEV__ false — TestFlight, App Store) ignore it and go to sign-in.
export default function DevLogin() {
  const { token, to } = useLocalSearchParams<{ token?: string; to?: string }>();
  const { signIn } = useAuth();
  useEffect(() => {
    if (!__DEV__ || !token) {
      router.replace("/sign-in");
      return;
    }
    signIn(token).then(() => router.replace((to || "/") as Href));
  }, [token, to, signIn]);
  return <CenteredSpinner label="Signing in" />;
}
