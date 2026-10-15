import { useEffect, useState } from "react";
import { View, Text, Platform, ActivityIndicator } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { api, ApiError } from "@/lib/api";

// What /api/auth/apple answers: a session for an existing account, or a
// short-lived token linking this Apple ID to the account about to be made.
export type AppleResult =
  | { kind: "signedIn"; token: string }
  | {
      kind: "new";
      appleToken: string;
      email: string | null;
      firstName: string | null;
      lastName: string | null;
    };

// "Continue with Apple" (30 Sept build notes, step 1 item 5): Apple's own
// black button, with a thin light-grey border so it stands out on navy.
// iOS only — renders nothing elsewhere (Android gets Google later).
export function AppleSignInButton({ onResult }: { onResult: (r: AppleResult) => void }) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    AppleAuthentication.isAvailableAsync().then(setAvailable).catch(() => setAvailable(false));
  }, []);

  if (!available) return null;

  async function start() {
    setError(null);
    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
    } catch (e) {
      // Closing the Apple sheet isn't an error.
      if ((e as { code?: string }).code !== "ERR_REQUEST_CANCELED") {
        setError("Apple sign-in didn't complete — try again, or use your email.");
      }
      return;
    }
    if (!credential.identityToken) {
      setError("Apple sign-in didn't complete — try again, or use your email.");
      return;
    }

    setBusy(true);
    try {
      const data = await api<{ token?: string; appleToken?: string; email?: string | null }>(
        "/api/auth/apple",
        { method: "POST", body: JSON.stringify({ identityToken: credential.identityToken }) },
      );
      if (data.token) {
        onResult({ kind: "signedIn", token: data.token });
      } else if (data.appleToken) {
        // Apple only shares the name on the very first sign-in with this app.
        onResult({
          kind: "new",
          appleToken: data.appleToken,
          email: data.email ?? null,
          firstName: credential.fullName?.givenName ?? null,
          lastName: credential.fullName?.familyName ?? null,
        });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "We couldn't reach TradeSura — check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <View className="overflow-hidden rounded-xl border border-white/40">
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          // Apple sizes the label from the button height — 44pt (Apple's
          // standard) keeps the text in proportion with the form below.
          cornerRadius={12}
          style={{ height: 44, opacity: busy ? 0.6 : 1 }}
          onPress={busy ? () => {} : start}
        />
        {busy && (
          <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
            <ActivityIndicator color="#ffffff" />
          </View>
        )}
      </View>
      {error && <Text className="mt-1.5 text-[14px] text-danger">{error}</Text>}
      <OrDivider />
    </View>
  );
}

// "or", then the email form — part of the button so it disappears with it.
function OrDivider() {
  return (
    <View className="my-3.5 flex-row items-center gap-3">
      <View className="h-px flex-1 bg-white/20" />
      <Text className="text-[13px] text-white/60">or</Text>
      <View className="h-px flex-1 bg-white/20" />
    </View>
  );
}
