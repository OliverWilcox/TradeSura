import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import {
  createAccountOnboardingLink,
  ensureRecipientConfiguration,
  getOrCreateConnectAccount,
  stripeConfigured,
} from "@/lib/stripe";
import { appUrl } from "@/lib/app-url";

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

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const accountId = await getOrCreateConnectAccount(engineer);
  if (accountId !== engineer.stripeAccountId) {
    await prisma.engineer.update({
      where: { id: engineerId },
      data: { stripeAccountId: accountId },
    });
    await track("stripe_account_created", { type: "ENGINEER", id: engineerId }, { accountId });
  } else {
    // Merchant-only accounts from before the recipient fix pick it up here,
    // so the link below collects whatever transfers still needs.
    await ensureRecipientConfiguration(accountId);
  }

  // Stripe's Account Links API only accepts http(s) return/refresh URLs, not
  // a bare custom scheme — connect-return bounces on to tradesura://onboarding.
  const url = await createAccountOnboardingLink(accountId, {
    returnUrl: `${appUrl()}/api/stripe/connect-return?stripe=return`,
    refreshUrl: `${appUrl()}/api/stripe/connect-return?stripe=refresh`,
  });
  return NextResponse.json({ url });
}
