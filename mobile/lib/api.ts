import { Platform } from "react-native";
import * as ExpoSecureStore from "expo-secure-store";

// expo-secure-store has no web implementation (getItemAsync throws
// "getValueWithKeyAsync is not a function"), which made `expo start --web`
// die on first render. Web is a dev-preview surface only (mobile/CLAUDE.md),
// so a localStorage shim is fine there; native keeps the real secure store.
const SecureStore =
  Platform.OS === "web"
    ? {
        getItemAsync: async (k: string) => globalThis.localStorage?.getItem(k) ?? null,
        setItemAsync: async (k: string, v: string) => {
          globalThis.localStorage?.setItem(k, v);
        },
        deleteItemAsync: async (k: string) => {
          globalThis.localStorage?.removeItem(k);
        },
      }
    : ExpoSecureStore;

const TOKEN_KEY = "ts_engineer_token";
const STRIPE_SKIPPED_KEY = "ts_stripe_skipped";
const HAS_SIGNED_IN_KEY = "ts_has_signed_in_before";
const HAS_SEEN_FIRST_PAYOUT_KEY = "ts_has_seen_first_payout";

// process.env.EXPO_PUBLIC_* is inlined by Metro at build time — see .env.example.
const API_URL = process.env.EXPO_PUBLIC_API_URL;

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// Temporary dev convenience — lets an engineer past the (tabs) gate without
// a completed Stripe onboarding while test-mode credentials aren't wired up.
// Device-local only, cleared on sign-out so a different engineer on the same
// device doesn't inherit someone else's skip.
export async function getStripeSkipped(): Promise<boolean> {
  return (await SecureStore.getItemAsync(STRIPE_SKIPPED_KEY)) === "1";
}

export async function setStripeSkipped(): Promise<void> {
  await SecureStore.setItemAsync(STRIPE_SKIPPED_KEY, "1");
}

export async function clearStripeSkipped(): Promise<void> {
  await SecureStore.deleteItemAsync(STRIPE_SKIPPED_KEY);
}

// W0 — "has this device signed in before" for the returning-user welcome
// state. Deliberately NOT cleared on sign-out: it's a device fact, not a
// session fact, so the welcome screen still promotes Sign in after signing
// out and back in.
export async function getHasSignedInBefore(): Promise<boolean> {
  return (await SecureStore.getItemAsync(HAS_SIGNED_IN_KEY)) === "1";
}

export async function setHasSignedInBefore(): Promise<void> {
  await SecureStore.setItemAsync(HAS_SIGNED_IN_KEY, "1");
}

// E11b — the one-time first-payout celebration. Shown once, ever, the first
// time payouts.tsx sees exactly one payout in the Stripe history.
export async function getHasSeenFirstPayout(): Promise<boolean> {
  return (await SecureStore.getItemAsync(HAS_SEEN_FIRST_PAYOUT_KEY)) === "1";
}

export async function setHasSeenFirstPayout(): Promise<void> {
  await SecureStore.setItemAsync(HAS_SEEN_FIRST_PAYOUT_KEY, "1");
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown = undefined,
  ) {
    super(message);
  }
}

// Thin fetch wrapper: attaches the engineer's bearer token and the API base
// URL so screens can call e.g. api("/api/dashboard") like the web app does.
// Every failure mode throws ApiError — including config/network errors, not
// just non-2xx responses — so every screen's `e instanceof ApiError ? e.message
// : "…"` catch block actually shows the real reason instead of a generic
// fallback (status 0 marks "never reached the server").
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not set — see mobile/.env.example.", 0);
  }
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      // Web preview only: lets a Vercel Deployment Protection session
      // cookie (set by signing in through Vercel's own SSO prompt on the
      // API origin directly) ride along on these cross-origin calls. A
      // no-op for native — RN's fetch has no browser cookie jar to send.
      credentials: "include",
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (e) {
    throw new ApiError(
      `Couldn't reach the server at ${API_URL} — ${e instanceof Error ? e.message : "check it's running and reachable from this device"}.`,
      0,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error ?? "Something went wrong.", res.status, data);
  }
  return data as T;
}

// For endpoints that return a raw file (e.g. the payouts CSV export) rather
// than JSON.
export async function apiText(path: string): Promise<string> {
  if (!API_URL) {
    throw new ApiError("EXPO_PUBLIC_API_URL is not set — see mobile/.env.example.", 0);
  }
  const token = await getToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (e) {
    throw new ApiError(
      `Couldn't reach the server at ${API_URL} — ${e instanceof Error ? e.message : "check it's running and reachable from this device"}.`,
      0,
    );
  }
  if (!res.ok) {
    throw new ApiError("Couldn't download that file.", res.status);
  }
  return res.text();
}
