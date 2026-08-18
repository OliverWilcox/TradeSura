import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "ts_engineer_token";
const GC_SKIPPED_KEY = "ts_gc_skipped";

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
// a real GoCardless connection while sandbox credentials aren't wired up.
// Device-local only, cleared on sign-out so a different engineer on the same
// device doesn't inherit someone else's skip.
export async function getGcSkipped(): Promise<boolean> {
  return (await SecureStore.getItemAsync(GC_SKIPPED_KEY)) === "1";
}

export async function setGcSkipped(): Promise<void> {
  await SecureStore.setItemAsync(GC_SKIPPED_KEY, "1");
}

export async function clearGcSkipped(): Promise<void> {
  await SecureStore.deleteItemAsync(GC_SKIPPED_KEY);
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
