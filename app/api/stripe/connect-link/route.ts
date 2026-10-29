import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createAccountOnboardingLink, stripeConfigured } from "@/lib/stripe";
import { appUrl } from "@/lib/app-url";
import { ensureConnectAccount } from "@/lib/stripe-onboarding";

// The only Stripe Connect onboarding initiator — the engineer surface is
// mobile-only. Returns the account-link URL as JSON (bearer-authenticated
// fetch); the mobile app opens it in an auth session and the browser
// navigation that follows can't carry an Authorization header. Both the
// return and refresh URLs deep-link straight back to the app, which then
// re-reads /api/me (that route syncs the connected-account status).
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Payment provider credentials aren't configured yet." },
      { status: 400 },
    );
  }

  const accountId = await ensureConnectAccount(engineerId);
  await prisma.engineer.updateMany({
    where: { id: engineerId, stripeOnboardingStartedAt: null },
    data: { stripeOnboardingStartedAt: new Date() },
  });

  // Stripe's Account Links API only accepts http(s) return/refresh URLs, not
  // a bare custom scheme — connect-return bounces on to tradesura://onboarding.
  const url = await createAccountOnboardingLink(accountId, {
    returnUrl: `${appUrl()}/api/stripe/connect-return?stripe=return`,
    refreshUrl: `${appUrl()}/api/stripe/connect-return?stripe=refresh`,
  });
  return NextResponse.json({ url });
}
