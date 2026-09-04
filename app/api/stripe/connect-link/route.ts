import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import {
  createAccountOnboardingLink,
  getOrCreateConnectAccount,
  stripeConfigured,
} from "@/lib/stripe";

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
  }

  const url = await createAccountOnboardingLink(accountId, {
    returnUrl: "tradesura://onboarding?stripe=return",
    refreshUrl: "tradesura://onboarding?stripe=refresh",
  });
  return NextResponse.json({ url });
}
