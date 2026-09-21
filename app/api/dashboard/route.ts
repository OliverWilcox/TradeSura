import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { brandName } from "@/lib/engineer";
import { activeMonthlyPence } from "@/lib/plans";
import { appFeePence } from "@/lib/clauses";
import { dueServices } from "@/lib/reminders";
import { getPayoutSummary, stripeConfigured } from "@/lib/stripe";
import { REFERRAL_REQUIRED_PLANS } from "@/lib/referral";
import { standingCopy } from "@/lib/verification-state";
import { track } from "@/lib/track";

// Mobile counterpart to the dashboard queries in app/page.tsx (Screen 02) —
// same logic, returned as JSON instead of rendered server-side.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const { totalPence, count } = await activeMonthlyPence(engineerId);
  const standing = standingCopy(engineer);

  // Part 6.2 — the active sub-line pattern is "N plans live · N offers out".
  const offersOut = await prisma.plan.count({ where: { engineerId, status: "PENDING" } });

  // Part 6.6 — the offers-waiting card: appears ~48h after an offer text,
  // fires once per offer ever (tracked via an event so a refresh doesn't
  // re-show one already surfaced), then that offer goes quiet.
  const waitingCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const shownEvents = await prisma.event.findMany({
    where: { name: "offer_waiting_card_shown", meta: { path: ["engineerId"], equals: engineerId } },
    select: { meta: true },
  });
  const alreadyShown = shownEvents
    .map((e) => (e.meta as { planId?: string } | null)?.planId)
    .filter((x): x is string => Boolean(x));
  const waitingPlan = await prisma.plan.findFirst({
    where: {
      engineerId,
      status: "PENDING",
      createdAt: { lte: waitingCutoff },
      id: { notIn: alreadyShown },
    },
    orderBy: { createdAt: "asc" },
    include: { customer: { select: { firstName: true } } },
  });
  let offersWaiting: { customerFirstName: string; planId: string } | null = null;
  if (waitingPlan) {
    offersWaiting = { customerFirstName: waitingPlan.customer.firstName, planId: waitingPlan.id };
    await track("offer_waiting_card_shown", { type: "SYSTEM" }, {
      engineerId,
      planId: waitingPlan.id,
    });
  }

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
    where: { engineerId, status: "LIVE" },
    _avg: { priceMonthlyPence: true },
  });
  const avgPence = Math.round(avgTier._avg.priceMonthlyPence ?? 1200);
  const prizeYearlyPence = Math.round((noPlan / 5) * avgPence * 12);

  const now = new Date();
  const upcoming = (await dueServices(engineerId))
    .filter((d) => d.dueDate >= now)
    .slice(0, 3)
    .map((d) => ({ ...d, dueDate: d.dueDate.toISOString() }));

  // Referral progress — Part 14 RULED: the £50 pays on the invitee's first
  // plan going live, so anyone still in this unpaid list simply hasn't gone
  // live yet. Today list: "Gary signed up with your invite — you'll get £50
  // when their first plan goes live."
  const invitees = await prisma.engineer.findMany({
    where: { referrerId: engineerId, referralBountyPaidAt: null },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const referral = invitees[0]
    ? { name: brandName(invitees[0]), required: REFERRAL_REQUIRED_PLANS }
    : null;

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
    offersOut,
    newThisMonth,
    failedRecently,
    noPlan,
    prizeYearlyPence,
    upcoming,
    nextPayoutPence,
    nextPayoutDate,
    referral,
    offersWaiting,
    standing,
  });
}
