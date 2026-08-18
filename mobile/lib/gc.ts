import * as Linking from "expo-linking";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";

// app/api/gc/callback/route.ts always redirects to tradesura://onboarding?gc=...
// with connected|denied|bad_state|exchange_failed. expo-web-browser reports any
// matching redirect as type "success" regardless of which gc= value came back,
// so the query param has to be decoded here to tell a real success from a
// failed OAuth exchange.
const GC_ERROR_MESSAGES: Record<string, string> = {
  denied: "Direct Debit connection was cancelled.",
  bad_state: "That connection link expired — try connecting again.",
  exchange_failed: "Couldn't complete the Direct Debit connection — try again.",
};

// Returns an error message if the GoCardless redirect indicates failure,
// or null if it was a real success (or the user just dismissed the browser).
export function gcResultError(result: WebBrowserAuthSessionResult): string | null {
  if (result.type !== "success") return null;
  const gc = Linking.parse(result.url).queryParams?.gc;
  if (gc === "connected") return null;
  return GC_ERROR_MESSAGES[String(gc)] ?? "Connection didn't complete — try again.";
}
