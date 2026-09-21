import * as Linking from "expo-linking";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";
import { api, ApiError } from "./api";

// app/api/stripe/connect-link builds an account-onboarding link whose return
// and refresh URLs both deep-link to tradesura://onboarding?stripe=return|refresh.
// expo-web-browser reports any matching redirect as type "success" regardless
// of which stripe= value came back, and Stripe onboarding can also be
// abandoned mid-flow, so the query param is decoded here. A "return" isn't a
// guarantee the account is fully enabled — the screen re-reads /api/me, which
// syncs the connected-account status from Stripe.
const STRIPE_MESSAGES: Record<string, string> = {
  refresh: "That setup link expired — tap to start again.",
};

// Build Guide v2 review 17 Sept, B3 — "'Couldn't start payment setup.' Red
// error on first attempt; worked on retry." Root cause: GET
// /api/stripe/connect-link does meaningfully more work the very first time
// an engineer taps this — it creates the actual Stripe Express account
// (business profile, capabilities, the works) before it can even ask
// Stripe for an onboarding link — whereas every later call just re-reads
// the now-existing account.stripeAccountId and skips straight to the link.
// That's a real, structural asymmetry (more external API calls + a DB
// write, all serial, on a cold path), not a flaky one-off — exactly the
// shape that shows up as "fails once, then works," especially from a cold
// serverless start. A single silent retry lands on the now-lighter path
// the same way a manual re-tap already did for the reviewer, so this
// fixes the actual user-visible symptom without needing to force a
// reproduction of whatever the underlying transient slowness was.
export async function getConnectLinkWithRetry(): Promise<{ url: string }> {
  try {
    return await api<{ url: string }>("/api/stripe/connect-link");
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // One retry, no backoff — the point isn't outlasting a rate limit, it's
    // giving the (now-idempotent, account-already-created) second call a
    // fair shot before surfacing anything to the engineer.
    return await api<{ url: string }>("/api/stripe/connect-link");
  }
}

// Returns a message if the Stripe redirect indicates the link needs
// restarting, or null on a normal return / user dismissal.
export function stripeResultError(result: WebBrowserAuthSessionResult): string | null {
  if (result.type !== "success") return null;
  const stripe = Linking.parse(result.url).queryParams?.stripe;
  if (stripe === "return") return null;
  return STRIPE_MESSAGES[String(stripe)] ?? null;
}
