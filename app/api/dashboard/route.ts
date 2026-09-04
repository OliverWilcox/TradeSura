import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { activeMonthlyPence } from "@/lib/plans";
import { appFeePence } from "@/lib/clauses";
import { dueServices } from "@/lib/reminders";
import { getPayoutSummary, stripeConfigured } from "@/lib/stripe";

// Mobile counterpart to the dashboard queries in app/page.tsx (Screen 02) —
// same logic, returned as JSON instead of rendered server-side.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const { totalPence, count } = await activeMonthlyPence(engineerId);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newThisMonth = await prisma.plan.count({
    where: { engineerId, status: "ACTIVE", activatedAt: { gte: monthStart } },
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const failedRecently = await prisma.event.count({
    where: {
      name: "payment_failed",
      ts: { gte: thirtyDaysAgo },
      meta: { path: ["engineerId"], equals: engineerId },
    },
  });

  const customersTotal = await prisma.customer.count({ where: { engineerId } });
  const onPlan = await prisma.customer.count({
    where: { engineerId, plans: { some: { status: "ACTIVE" } } },
  });
  const noPlan = customersTotal - onPlan;
  const avgTier = await prisma.planTier.aggregate({
    where: { engineerId, archived: false },
    _avg: { priceMonthlyPence: true },
  });
  const avgPence = Math.round(avgTier._avg.priceMonthlyPence ?? 1200);
  const prizeYearlyPence = Math.round((noPlan / 5) * avgPence * 12);

  const now = new Date();
  const upcoming = (await dueServices(engineerId))
    .filter((d) => d.dueDate >= now)
    .slice(0, 3)
    .map((d) => ({ ...d, dueDate: d.dueDate.toISOString() }));

  // Referral progress — the most-advanced not-yet-paid invitee (for the
  // Today list: "Gary's nearly live — 4/5 plans to your £50").
  const invitees = await prisma.engineer.findMany({
    where: { referrerId: engineerId, referralBountyPaidAt: null },
  });
  let referral: { name: string; activePlans: number; required: number } | null = null;
  for (const e of invitees) {
    const p = await prisma.plan.count({ where: { engineerId: e.id, status: "ACTIVE" } });
    if (!referral || p > referral.activePlans) {
      referral = { name: e.tradingName ?? e.slug, activePlans: p, required: 5 };
    }
  }

  let nextPayoutPence: number | null = null;
  let nextPayoutDate: string | null = null;
  if (stripeConfigured() && engineer.stripeAccountId && engineer.stripePayoutsEnabled) {
    try {
      const s = await getPayoutSummary(engineer.stripeAccountId);
      if (s.nextPayout) {
        nextPayoutPence = s.nextPayout.amountPence;
        nextPayoutDate = s.nextPayout.arrivalDate;
      }
    } catch {
      // Non-fatal — the dashboard still renders without a live payout figure.
    }
  }
  // Fallback: the expected 80% of active-plan collections.
  if (nextPayoutPence === null && totalPence > 0) {
    nextPayoutPence = totalPence - appFeePence(totalPence);
  }

  return NextResponse.json({
    totalPence,
    count,
    newThisMonth,
    failedRecently,
    noPlan,
    prizeYearlyPence,
    upcoming,
    nextPayoutPence,
    nextPayoutDate,
    referral,
  });
}
