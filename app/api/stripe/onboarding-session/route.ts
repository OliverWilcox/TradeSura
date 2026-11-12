import { NextResponse } from "next/server";
import { getEngineerId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createOnboardingSession, platformCollectsDetails, publishableKey, stripeConfigured } from "@/lib/stripe";
import { ensureConnectAccount } from "@/lib/stripe-onboarding";

// Matt, 12 Nov — payment set-up inside the app. For an account TradeSura
// collects details for (a Custom account), returns what the app needs to show
// Stripe's onboarding form in the Get paid screen, with no Stripe sign-in.
// Older Express accounts get { mode: "hosted" } and use /api/stripe/connect-link.
export async function POST() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Payment provider credentials aren't configured yet." }, { status: 400 });
  }
  const accountId = await ensureConnectAccount(engineerId);
  if (!(await platformCollectsDetails(accountId))) return NextResponse.json({ mode: "hosted" });
  await prisma.engineer.updateMany({
    where: { id: engineerId, stripeOnboardingStartedAt: null },
    data: { stripeOnboardingStartedAt: new Date() },
  });
  const clientSecret = await createOnboardingSession(accountId);
  return NextResponse.json({ mode: "embedded", clientSecret, publishableKey: publishableKey() });
}
