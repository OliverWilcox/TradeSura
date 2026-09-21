import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { getConnectAccountStatus, stripeConfigured } from "@/lib/stripe";

// Engineer profile — used by the mobile app to gate onboarding vs. the tab
// shell, and to pre-fill the onboarding form. When a Stripe account exists
// but isn't enabled yet, this refreshes its status live so the app doesn't
// have to wait for the account.updated webhook after onboarding returns.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  let engineer = await prisma.engineer.findUnique({ where: { id: engineerId } });
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (
    stripeConfigured() &&
    engineer.stripeAccountId &&
    !(engineer.stripeChargesEnabled && engineer.stripePayoutsEnabled)
  ) {
    try {
      const s = await getConnectAccountStatus(engineer.stripeAccountId);
      if (
        s.detailsSubmitted !== engineer.stripeDetailsSubmitted ||
        s.chargesEnabled !== engineer.stripeChargesEnabled ||
        s.payoutsEnabled !== engineer.stripePayoutsEnabled
      ) {
        engineer = await prisma.engineer.update({
          where: { id: engineerId },
          data: {
            stripeDetailsSubmitted: s.detailsSubmitted,
            stripeChargesEnabled: s.chargesEnabled,
            stripePayoutsEnabled: s.payoutsEnabled,
          },
        });
      }
    } catch (err) {
      console.error("[me] Stripe account status refresh failed:", err);
    }
  }

  // Build Guide v2 Part 7.3 — the routing distinction is "any plan at all"
  // (anyTierCount, any status: zero → every door opens the wizard directly)
  // vs. "a plan is actually offerable" (hasPlan: LIVE only — gates the
  // Add-customer hero, the offer flow, and onboarding's step 2).
  const [anyTierCount, liveTierCount, customerCount, activePlans] = await Promise.all([
    prisma.planTier.count({ where: { engineerId } }),
    prisma.planTier.count({ where: { engineerId, status: "LIVE" } }),
    prisma.customer.count({ where: { engineerId } }),
    prisma.plan.count({ where: { engineerId, status: "ACTIVE" } }),
  ]);

  return NextResponse.json({
    id: engineer.id,
    email: engineer.email,
    firstName: engineer.firstName,
    lastName: engineer.lastName,
    phone: engineer.phone,
    phoneVerifiedAt: engineer.phoneVerifiedAt,
    businessType: engineer.businessType,
    companyNumber: engineer.companyNumber,
    postcode: engineer.postcode,
    tradingName: engineer.tradingName,
    logoUrl: engineer.logoUrl,
    slug: engineer.slug,
    gasSafeVerifiedAt: engineer.gasSafeVerifiedAt,
    gasSafeReviewRequestedAt: engineer.gasSafeReviewRequestedAt,
    gasSafeNo: engineer.gasSafeNo,
    gasSafeName: engineer.gasSafeName,
    gasSafeCompany: engineer.gasSafeCompany,
    gasSafeCategories: engineer.gasSafeCategories,
    stripeConnected: engineer.stripeChargesEnabled,
    stripeDetailsSubmitted: engineer.stripeDetailsSubmitted,
    stripePayoutsEnabled: engineer.stripePayoutsEnabled,
    hasPlan: liveTierCount > 0,
    anyTierCount,
    customerCount,
    activePlans,
    packRequestedAt: engineer.packRequestedAt,
  });
}
