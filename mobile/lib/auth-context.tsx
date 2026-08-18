import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  api,
  clearGcSkipped,
  clearToken,
  getGcSkipped,
  getToken,
  setGcSkipped,
  setToken,
} from "./api";

export type Me = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneVerifiedAt: string | null;
  businessType: string | null;
  companyNumber: string | null;
  postcode: string | null;
  tradingName: string | null;
  slug: string;
  gasSafeVerifiedAt: string | null;
  gasSafeNo: string | null;
  gasSafeName: string | null;
  gasSafeCompany: string | null;
  gasSafeCategories: string | null;
  gcConnected: boolean;
  gcOrganisationId: string | null;
};

type AuthState = {
  token: string | null;
  loading: boolean;
  me: Me | null;
  meLoading: boolean;
  meError: string | null;
  gcSkipped: boolean;
  skipGc: () => Promise<void>;
  refreshMe: () => Promise<void>;
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
  const [gcSkipped, setGcSkippedState] = useState(false);

  useEffect(() => {
    getToken()
      .then(setTokenState)
      .finally(() => setLoading(false));
    getGcSkipped().then(setGcSkippedState);
  }, []);

  const refreshMe = useCallback(async () => {
    setMeLoading(true);
    setMeError(null);
    try {
      const data = await api<Me>("/api/me");
      setMe(data);
    } catch {
      setMe(null);
      setMeError("Couldn't load your profile.");
    } finally {
      setMeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) refreshMe();
    else setMe(null);
  }, [token, refreshMe]);

  async function signIn(newToken: string) {
    await setToken(newToken);
    setTokenState(newToken);
  }

  async function signOut() {
    await clearToken();
    await clearGcSkipped();
    setTokenState(null);
    setMe(null);
    setGcSkippedState(false);
  }

  async function skipGc() {
    await setGcSkipped();
    setGcSkippedState(true);
  }

  return (
    <AuthContext.Provider
      value={{ token, loading, me, meLoading, meError, gcSkipped, skipGc, refreshMe, signIn, signOut }}
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
