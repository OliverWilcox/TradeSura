import * as Linking from "expo-linking";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";

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

// Returns a message if the Stripe redirect indicates the link needs
// restarting, or null on a normal return / user dismissal.
export function stripeResultError(result: WebBrowserAuthSessionResult): string | null {
  if (result.type !== "success") return null;
  const stripe = Linking.parse(result.url).queryParams?.stripe;
  if (stripe === "return") return null;
  return STRIPE_MESSAGES[String(stripe)] ?? null;
}
