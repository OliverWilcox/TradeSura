import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { activeMonthlyPence } from "@/lib/plans";
import { appFeePence } from "@/lib/clauses";
import { getPayoutSummary, stripeConfigured, type PayoutSummary } from "@/lib/stripe";
import { standingCopy, paymentsStatus } from "@/lib/verification-state";

// E11 — Payouts & collections. When the engineer's Stripe account is live this
// returns real balance + payout history; until then it falls back to the
// maths of their active plans.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const { totalPence, count } = await activeMonthlyPence(engineerId);
  const fee = appFeePence(totalPence);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [confirmed, failedEvents, referralBonuses] = await Promise.all([
    prisma.event.count({
      where: {
        name: "payment_confirmed",
        ts: { gte: monthStart },
        meta: { path: ["engineerId"], equals: engineerId },
      },
    }),
    prisma.event.findMany({
      where: {
        name: "payment_failed",
        ts: { gte: thirtyDaysAgo },
        meta: { path: ["engineerId"], equals: engineerId },
      },
      orderBy: { ts: "desc" },
    }),
    prisma.event.findMany({
      where: {
        name: "referral_activated",
        ts: { gte: monthStart },
        meta: { path: ["referrerId"], equals: engineerId },
      },
    }),
  ]);

  const referralBonusPence = referralBonuses.reduce(
    (sum, e) => sum + ((e.meta as { bountyPence?: number } | null)?.bountyPence ?? 5000),
    0,
  );
  // ~32p per Bacs collection (1% + 20p capped £4), estimated on confirmed count.
  const processingPence = confirmed * 32;

  const failedPlanIds = [
    ...new Set(
      failedEvents
        .map((e) => (e.meta as { planId?: string } | null)?.planId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const failedPlans = await prisma.plan.findMany({
    where: { id: { in: failedPlanIds }, status: { not: "CANCELLED" } },
    include: { customer: true },
  });

  let stripe: PayoutSummary | null = null;
  let stripeError = false;
  if (stripeConfigured() && engineer.stripeAccountId && engineer.stripePayoutsEnabled) {
    try {
      stripe = await getPayoutSummary(engineer.stripeAccountId);
    } catch (err) {
      console.error("[payouts] Stripe summary failed:", err);
      stripeError = true;
    }
  }

  return NextResponse.json({
    totalPence,
    count,
    fee,
    confirmed,
    referralBonusPence,
    processingPence,
    bankLast4: stripe?.bankLast4 ?? null,
    stripe,
    stripeError,
    accountRestricted: Boolean(engineer.stripeAccountId) && !engineer.stripeChargesEnabled,
    // Part 12 LAW — "an amber slim banner... it reads the standing strip's
    // truth source. Red stays reserved for genuinely broken." `standing`
    // covers banned/paused (genuinely red); `payments` covers Stripe
    // specifically (amber while mid-onboarding).
    standing: standingCopy(engineer),
    payments: paymentsStatus(engineer),
    failedPlans: failedPlans.map((p) => ({
      id: p.id,
      customerName: `${p.customer.firstName} ${p.customer.lastName}`,
      priceMonthlyPence: p.priceMonthlyPence ?? 0,
    })),
  });
}
