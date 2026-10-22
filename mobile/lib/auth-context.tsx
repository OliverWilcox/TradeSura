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
  customerCount: number;
  activePlans: number;
  packRequestedAt: string | null;
  profilePublishedAt: string | null;
  websiteConnectedAt: string | null;
  inviteSharedAt: string | null;
  referralCount: number;
  firstPlan: { name: string; priceMonthlyPence: number } | null;
  draftPlan?: { id: string; name: string } | null;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);
  const [stripeSkipped, setStripeSkippedState] = useState(false);

  useEffect(() => {
    getToken()
      .then(setTokenState)
      .finally(() => setLoading(false));
    getStripeSkipped().then(setStripeSkippedState);
  }, []);

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
      if (state === "active") refreshMe();
    });
    return () => sub.remove();
  }, [token, refreshMe]);

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
