import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { brandName } from "@/lib/engineer";
import { activeMonthlyPence, collectionsSince, payoutWeekStart } from "@/lib/plans";
import { dueServices } from "@/lib/reminders";
import { getPayoutSummary, stripeConfigured } from "@/lib/stripe";
import { referralRatePercent } from "@/lib/referral";
import { recentEmergencyCount } from "@/lib/emergencies";
import { standingCopy } from "@/lib/verification-state";
import { track } from "@/lib/track";
import { firstMemberYearlyPence } from "@/lib/first-member";

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

  // Referral progress (Build Review 2, ruling 4): the newest invitee who isn't
  // earning for them yet. "Gary signed up with your invite — you'll earn 25%
  // of our fee on every plan they sell."
  const invitees = await prisma.engineer.findMany({
    where: { referrerId: engineerId, referredEarnings: { none: {} } },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  const referral = invitees[0]
    ? { name: brandName(invitees[0]), ratePercent: referralRatePercent(invitees[0].createdAt) }
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
  // Fallback before Stripe reports a payout — Part 6.3 LAW: "this week's
  // confirmed collections × 80%. Never the monthly figure × 80%."
  if (nextPayoutPence === null && totalPence > 0) {
    nextPayoutPence = (await collectionsSince(engineerId, payoutWeekStart())).toBankPence;
  }

  // Messages is hidden from Account for October (Build Review 2), so Home is
  // where the engineer sees that the gas-emergency interlock fired.
  const emergencies = await recentEmergencyCount(engineerId);

  // Review 3 §3 — the "first customer" celebration. Only while exactly one
  // plan has ever gone live, so long-standing accounts never see it.
  let firstMember: { planId: string; customerFirstName: string; planName: string; yearlyPence: number } | null = null;
  if (count === 1 && (await prisma.plan.count({ where: { engineerId, activatedAt: { not: null } } })) === 1) {
    const p = await prisma.plan.findFirst({
      where: { engineerId, status: "ACTIVE" },
      include: { customer: { select: { firstName: true } }, tier: { select: { name: true } } },
    });
    if (p) {
      firstMember = {
        planId: p.id,
        customerFirstName: p.customer.firstName,
        planName: p.tier?.name ?? "your plan",
        yearlyPence: firstMemberYearlyPence(p.priceMonthlyPence ?? 0, p.billingInterval),
      };
    }
  }

  return NextResponse.json({
    firstMember,
    emergencies,
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
