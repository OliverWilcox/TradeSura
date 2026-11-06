import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { setOverdueBadge, unregisterPush } from "@/lib/push";
import {
  api,
  clearStripeSkipped,
  clearToken,
  getStripeSkipped,
  getToken,
  setHasSignedInBefore,
  setStripeSkipped,
  setToken,
} from "./api";

// Mirrors ../lib/stripe.ts stripeSetupState.
export type StripeState = "none" | "half" | "needs_more" | "checking" | "ready";

export type Me = {
  // Build Review 2, section 8 — staff get a cut-down app inside their
  // owner's business; money and settings fields are absent for them.
  role: "owner" | "staff";
  businessName?: string;
  signUpsThisWeek?: number;
  gasSafeRejectedAt?: string | null;
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  businessType: string | null;
  companyNumber: string | null;
  // Build Review 3 — Companies House name, "only owner?" answer, and R5's
  // VAT setting. Owner-only; absent for staff.
  legalName?: string | null;
  soleOwner?: boolean | null;
  vatRegistered?: boolean;
  postcode: string | null;
  tradingName: string | null;
  logoUrl: string | null;
  slug: string;
  gasSafeVerifiedAt: string | null;
  gasSafeReviewRequestedAt: string | null;
  hasGasSafeCard?: boolean;
  gasSafeNo: string | null;
  gasSafeName: string | null;
  gasSafeCompany: string | null;
  gasSafeCategories: string | null;
  stripeConnected: boolean;
  stripeDetailsSubmitted: boolean;
  stripePayoutsEnabled: boolean;
  // Build Review 3 — payment setup progress (owners only; absent for staff).
  stripeState?: StripeState;
  hasPlan: boolean;
  /** Plans of any status, drafts included. */
  anyTierCount?: number;
  customerCount: number;
  activePlans: number;
  packRequestedAt: string | null;
  packAddress?: string | null;
  packShippedAt?: string | null;
  profilePublishedAt: string | null;
  websiteConnectedAt: string | null;
  inviteSharedAt: string | null;
  referralCount: number;
  firstPlan: { name: string; priceMonthlyPence: number } | null;
  draftPlan?: { id: string; name: string } | null;
  /** Matt, 6 Nov — the Grow cards' progress (owners only, lib/grow.ts). */
  grow?: {
    firstTenSent: number;
    goal: { target: number | null; signed: number; worthPence: number; pace: number; behind: boolean };
    howToVideo: { url: string | null; watchedAt: string | null };
    staff: { count: number; commission: { type: "signup" | "monthly"; pence: number } | null };
  };
};

type AuthState = {
  token: string | null;
  loading: boolean;
  me: Me | null;
  meLoading: boolean;
  meError: string | null;
  stripeSkipped: boolean;
  skipStripe: () => Promise<void>;
  // Resolves with the fresh profile (null if it failed to load).
  refreshMe: () => Promise<Me | null>;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// 30 Oct update 3.5 — "Stay logged in". A session lasts 180 days; once a
// token has under 150 days left (about a month after it was issued) the app
// swaps it for a fresh one, so a phone in regular use never signs out.
const RENEW_WHEN_LEFT_MS = 150 * 24 * 60 * 60 * 1000;

function expiresAt(token: string): number | null {
  try {
    const part = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    const exp = part ? (JSON.parse(atob(part)) as { exp?: number }).exp : undefined;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export function needsRenewal(token: string, now = Date.now()): boolean {
  const exp = expiresAt(token);
  return exp !== null && exp - now < RENEW_WHEN_LEFT_MS;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [stripeSkipped, setStripeSkippedState] = useState(false);

  // Best-effort: a failed renewal just tries again next time; the current
  // token keeps working until it really expires.
  const renewSession = useCallback(async (current: string) => {
    if (!needsRenewal(current)) return;
    try {
      const { token: fresh } = await api<{ token: string }>("/api/auth/refresh", { method: "POST" });
      await setToken(fresh);
      setTokenState(fresh);
    } catch {
      // offline or signed out elsewhere — nothing to do here
    }
  }, []);

  useEffect(() => {
    getToken()
      .then((saved) => {
        setTokenState(saved);
        if (saved) renewSession(saved);
      })
      .finally(() => setLoading(false));
    getStripeSkipped().then(setStripeSkippedState);
  }, [renewSession]);

  const refreshMe = useCallback(async (): Promise<Me | null> => {
    setMeLoading(true);
    setMeError(null);
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
      return data;
    } catch {
      setMe(null);
      setMeError("Couldn't load your profile.");
      return null;
    } finally {
      setMeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) refreshMe();
    else setMe(null);
  }, [token, refreshMe]);


  // Coming back to the app is when outside changes land (badge approved,
  // Stripe onboarding finished in the browser) — re-read the profile.
  useEffect(() => {
    if (!token) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        refreshMe();
        renewSession(token);
      }
    });
    return () => sub.remove();
  }, [token, refreshMe, renewSession]);

  async function signIn(newToken: string) {
    await setToken(newToken);
    await setHasSignedInBefore();
    setTokenState(newToken);
  }

  async function signOut() {
    await unregisterPush();
    setOverdueBadge(0);
    await clearToken();
    await clearStripeSkipped();
    setTokenState(null);
    setMe(null);
    setStripeSkippedState(false);
  }

  async function skipStripe() {
    await setStripeSkipped();
    setStripeSkippedState(true);
  }

  return (
    <AuthContext.Provider
      value={{ token, loading, me, meLoading, meError, stripeSkipped, skipStripe, refreshMe, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
