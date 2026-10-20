import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { brandName } from "@/lib/engineer";
import { deleteOwnerAccount, deleteStaffAccount } from "@/lib/delete-account";
import { getConnectAccountStatus, stripeConfigured } from "@/lib/stripe";

// Engineer profile — used by the mobile app to gate onboarding vs. the tab
// shell, and to pre-fill the onboarding form. When a Stripe account exists
// but isn't enabled yet, this refreshes its status live so the app doesn't
// have to wait for the account.updated webhook after onboarding returns.
export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (actor.role === "staff") return staffMe(actor.actorId, actor.businessId);
  const engineerId = actor.businessId;

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
  const [anyTierCount, liveTierCount, customerCount, activePlans, referralCount] = await Promise.all([
    prisma.planTier.count({ where: { engineerId } }),
    prisma.planTier.count({ where: { engineerId, status: "LIVE" } }),
    prisma.customer.count({ where: { engineerId } }),
    prisma.plan.count({ where: { engineerId, status: "ACTIVE" } }),
    prisma.engineer.count({ where: { referrerId: engineerId } }),
  ]);
  // The getting-started hub names the first live plan on its done step.
  const firstPlan = await prisma.planTier.findFirst({
    where: { engineerId, status: "LIVE" },
    orderBy: { sortOrder: "asc" },
    select: { name: true, priceMonthlyPence: true },
  });

  return NextResponse.json({
    role: "owner",
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
    hasGasSafeCard: Boolean(engineer.gasSafeCardUrl),
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
    gasSafeRejectedAt: engineer.gasSafeRejectedAt,
    profilePublishedAt: engineer.profilePublishedAt,
    websiteConnectedAt: engineer.websiteConnectedAt,
    inviteSharedAt: engineer.inviteSharedAt,
    referralCount,
    firstPlan,
  });
}

// Build Review 2, section 8 — the staff app is the same shell, cut down. It
// needs their own identity and badge status, the business's name, and
// whether there's a live plan to offer; never money or settings.
async function staffMe(staffId: string, businessId: string) {
  // "Their own count of sign-ups this week (a number, never £)" — since Monday.
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const [staff, owner, liveTierCount, customerCount, signUpsThisWeek] = await Promise.all([
    prisma.engineer.findUniqueOrThrow({ where: { id: staffId } }),
    prisma.engineer.findUniqueOrThrow({ where: { id: businessId } }),
    prisma.planTier.count({ where: { engineerId: businessId, status: "LIVE" } }),
    prisma.customer.count({ where: { engineerId: businessId, addedById: staffId } }),
    prisma.plan.count({ where: { soldById: staffId, activatedAt: { gte: monday } } }),
  ]);
  return NextResponse.json({
    role: "staff",
    id: staff.id,
    email: staff.email,
    firstName: staff.firstName,
    lastName: staff.lastName,
    phone: staff.phone,
    tradingName: owner.tradingName,
    businessName: brandName(owner),
    logoUrl: owner.logoUrl,
    slug: owner.slug,
    gasSafeVerifiedAt: staff.gasSafeVerifiedAt,
    gasSafeRejectedAt: staff.gasSafeRejectedAt,
    gasSafeReviewRequestedAt: staff.gasSafeReviewRequestedAt,
    hasGasSafeCard: Boolean(staff.gasSafeCardUrl),
    gasSafeNo: staff.gasSafeNo,
    // The business's payment setup decides whether customers can join.
    stripeConnected: owner.stripeChargesEnabled,
    hasPlan: liveTierCount > 0,
    customerCount,
    signUpsThisWeek,
  });
}

// Build Review 2, section 10 — in-app account deletion (App Store 5.1.1).
// The app confirms first; owners with customers on live plans are refused
// with what to do instead.
export async function DELETE() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const result =
    actor.role === "staff"
      ? await deleteStaffAccount(actor.actorId)
      : await deleteOwnerAccount(actor.businessId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, livePlans: result.livePlans }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
