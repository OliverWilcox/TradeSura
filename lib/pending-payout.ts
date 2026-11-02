import { prisma } from "@/lib/db";
import { firstMemberYearlyPence } from "@/lib/first-member";
import { FIRST_PAYOUT_HOLD_DAYS, payoutTimeline, type PayoutTimeline } from "@/lib/payout-timeline";

export type PendingPayout = {
  /** The engineer's share of their live plans, a month (after our 20%). */
  monthlyPence: number;
  /** The Friday their first payout should land. */
  firstPayoutAt: string;
};

export type TimelineView = {
  /** "customer": their first customer's real dates; "example": a customer joining today. */
  basis: "customer" | "example";
  customerFirstName: string | null;
  timeline: PayoutTimeline;
};

async function hasBeenPaid(engineerId: string): Promise<boolean> {
  const e = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { firstPayoutEmailAt: true } });
  return Boolean(e?.firstPayoutEmailAt);
}

async function livePlans(engineerId: string) {
  return prisma.plan.findMany({
    where: { engineerId, status: "ACTIVE" },
    select: {
      priceMonthlyPence: true,
      billingInterval: true,
      activatedAt: true,
      createdAt: true,
      coolingOffEndsAt: true,
      customer: { select: { firstName: true } },
    },
    orderBy: { activatedAt: "asc" },
  });
}

function timelineFor(p: { activatedAt: Date | null; createdAt: Date; coolingOffEndsAt: Date | null }, holdDays: number, now: Date) {
  return payoutTimeline({ joinedAt: p.activatedAt ?? p.createdAt, firstCollectionAt: p.coolingOffEndsAt, holdDays, now });
}

/**
 * Matt, 30 Oct §9.3 — Home's "£18.40 a month pending · first payout Fri [date]".
 * Only until the first payout lands (then Home shows the real next payout).
 */
export async function pendingFirstPayout(engineerId: string, now = new Date()): Promise<PendingPayout | null> {
  if (await hasBeenPaid(engineerId)) return null;
  const plans = await livePlans(engineerId);
  if (plans.length === 0) return null;
  const monthlyPence = plans.reduce(
    (sum, p) => sum + Math.round(firstMemberYearlyPence(p.priceMonthlyPence ?? 0, p.billingInterval) / 12),
    0,
  );
  const firstPayoutAt = plans
    .map((p) => timelineFor(p, FIRST_PAYOUT_HOLD_DAYS, now).payoutAt)
    .sort()[0];
  return { monthlyPence, firstPayoutAt };
}

/**
 * The timeline on the payment screen and the Payouts tab: the first
 * customer's real dates while the first payout is still to come, otherwise a
 * customer joining today (no first-payout hold once they've been paid).
 */
export async function timelineView(engineerId: string, now = new Date()): Promise<TimelineView> {
  const paid = await hasBeenPaid(engineerId);
  if (!paid) {
    const [first] = await livePlans(engineerId);
    if (first) {
      return {
        basis: "customer",
        customerFirstName: first.customer.firstName,
        timeline: timelineFor(first, FIRST_PAYOUT_HOLD_DAYS, now),
      };
    }
  }
  return {
    basis: "example",
    customerFirstName: null,
    timeline: payoutTimeline({ joinedAt: now, holdDays: paid ? 0 : FIRST_PAYOUT_HOLD_DAYS, now }),
  };
}
