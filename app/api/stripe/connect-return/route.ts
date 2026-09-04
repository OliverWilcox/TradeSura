import { NextResponse } from "next/server";

// Stripe's Account Links API requires http(s) return_url/refresh_url — it
// rejects a bare custom scheme like tradesura://... outright ("Not a valid
// URL", param return_url). So connect-link registers this route as the
// return/refresh target instead, and this just bounces straight on to the
// app's real deep link, preserving the ?stripe=return|refresh contract that
// mobile/lib/stripe.ts's stripeResultError() reads.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const stripe = searchParams.get("stripe") === "refresh" ? "refresh" : "return";
  return NextResponse.redirect(`tradesura://onboarding?stripe=${stripe}`);
}
