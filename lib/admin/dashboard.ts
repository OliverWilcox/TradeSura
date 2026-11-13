import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { addDays, daysBetween, ukDay, ukMidnight, weekStart } from "@/lib/admin/time";
import { bounded, shared } from "@/lib/admin-api/db";
import {
  ACTIVE_WINDOW_DAYS,
  FUNNEL_STEPS,
  activeEngineerIds,
  funnelOf,
  milestones,
  offerCounts,
  offers,
  paymentTotals,
  payments,
  realPlanWhere,
  testMarks,
  verifiedEngineerCount,
  type FunnelStep,
  type Range,
  type TestMarks,
} from "@/lib/admin/metrics";

// The admin dashboard's sections, from the live database, one function per
// section so the admin app can stream them. Every count comes from
// lib/admin/metrics.ts, so a card, the funnel and the lists say the same
// thing for the same range: the admin app shows the definition beside each
// (its features/dashboard/definitions.ts). Ranges are instants: [from, to).
//
// The heavy sections (the funnel, money) run with a statement timeout, and
// callers asking for the same range at the same time share one run
// (lib/admin-api/db.ts).

export type { Range };

/** Plans live at an instant: started before it and not ended by it. */
function liveAt(at: Date) {
  return { activatedAt: { lt: at }, OR: [{ cancelledAt: null }, { cancelledAt: { gte: at } }] };
}

/**
 * Customers with a live plan at an instant (mandate not still pending), counted
 * in the database rather than loaded. A plan with no mandate status isn't
 * counted (`<>` is never true for NULL), as before.
 */
async function customersOnPlans(at: Date, marks: TestMarks): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT p."customerId") AS n FROM "Plan" p JOIN "Engineer" e ON e.id = p."engineerId"
    WHERE p."activatedAt" < ${at} AND (p."cancelledAt" IS NULL OR p."cancelledAt" >= ${at})
      AND p."mandateStatus" <> 'pending'
      AND e."deletedAt" IS NULL AND NOT (p."engineerId" = ANY(${marks.engineers}::text[])) AND NOT (p."customerId" = ANY(${marks.customers}::text[]))`;
  return Number(row.n);
}

// --- Core: offers per engineer per week --------------------------------------

export type WeekValue = { weekStart: string; offers: number; activeEngineers: number; value: number };

/** Delivered offers in each UK week ÷ verified engineers at the end of it (this week: so far, and now). */
export async function core(now: Date, weeks = 12) {
  const marks = await testMarks();
  const thisWeek = weekStart(ukDay(now));
  const starts = [...Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - i))), thisWeek];
  const ends = starts.map((w, i) => (i === weeks ? now : ukMidnight(addDays(w, 7))));
  const [sent, engineers] = await Promise.all([
    offers(marks, { from: ukMidnight(starts[0]), to: now }),
    Promise.all(ends.map((end) => verifiedEngineerCount(marks, end))),
  ]);
  const delivered = sent.filter((o) => o.delivery === "delivered");
  const values: WeekValue[] = starts.map((w, i) => {
    const from = ukMidnight(w);
    const n = delivered.filter((o) => o.sentAt >= from && o.sentAt < ends[i]).length;
    return { weekStart: w, offers: n, activeEngineers: engineers[i], value: engineers[i] ? n / engineers[i] : 0 };
  });
  const trend = values.slice(0, weeks);
  const lastWeek = trend[trend.length - 1];
  const previousWeek = trend[trend.length - 2];
  return { lastWeek, previousWeek, weekToDate: values[weeks], change: lastWeek.value - previousWeek.value, trend };
}

// --- Headline numbers ---------------------------------------------------------

/**
 * Sign-ups and verified are the funnel's first steps for the same engineers,
 * so the cards and the funnel can't disagree; "verified in total" is the
 * core number's divisor at the end of the range.
 */
export async function stats(range: Range) {
  const marks = await testMarks();
  const [cohort, verifiedTotal, active, plansLive, customers, sent] = await Promise.all([
    milestones(marks, { signedUp: range }),
    verifiedEngineerCount(marks, range.to),
    activeEngineerIds(marks, range.to),
    prisma.plan.count({ where: { ...liveAt(range.to), ...realPlanWhere(marks) } }),
    customersOnPlans(range.to, marks),
    offers(marks, range),
  ]);
  const delivered = sent.filter((o) => o.delivery === "delivered");
  const converted = delivered.length
    ? await prisma.plan.count({ where: { id: { in: delivered.map((o) => o.planId) }, activatedAt: { not: null } } })
    : 0;
  return {
    signups: cohort.size,
    verified: { ofSignups: [...cohort.values()].filter((m) => m.verified.reached).length, total: verifiedTotal },
    active: active.size,
    activeWindowDays: ACTIVE_WINDOW_DAYS,
    plansLive,
    customers,
    offers: offerCounts(sent),
    conversion: { sent: delivered.length, converted, rate: delivered.length ? converted / delivered.length : 0 },
  };
}

// --- Sign-ups -------------------------------------------------------------------

/**
 * How an engineer heard about TradeSura, as far as it can be trusted: a
 * letter only when they redeemed a claim code from one (the answer "Letter"
 * on its own is kept apart), and "not given" when there's no answer.
 */
const CHANNEL_SQL = Prisma.sql`CASE
  WHEN cc.code IS NOT NULL THEN 'letter'
  WHEN e.attribution->>'heardVia' = 'letter' THEN 'letter_unverified'
  ELSE COALESCE(e.attribution->>'heardVia', 'not_given') END`;

export async function signups({ from, to }: Range) {
  const marks = await testMarks();
  // The same engineers as the Sign-ups card and the funnel.
  const rows = await bounded(prisma.$queryRaw<{ createdAt: Date; channel: string }[]>`
    SELECT e."createdAt", ${CHANNEL_SQL} AS channel
    FROM "Engineer" e LEFT JOIN "ClaimCode" cc ON cc."redeemedByEngineerId" = e.id
    WHERE e."ownerId" IS NULL AND e."deletedAt" IS NULL AND NOT (e.id = ANY(${marks.engineers}::text[]))
      AND e."createdAt" >= ${from} AND e."createdAt" < ${to}`);
  const byDay = new Map<string, number>();
  const channels = new Map<string, number>();
  for (const r of rows) {
    const day = ukDay(r.createdAt);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    channels.set(r.channel, (channels.get(r.channel) ?? 0) + 1);
  }
  // Every UK day the range touches, from its first instant to its last.
  const lastDay = ukDay(new Date(to.getTime() - 1));
  return {
    byDay: daysBetween(ukDay(from), addDays(lastDay, 1)).map((date) => ({ date, count: byDay.get(date) ?? 0 })),
    channels: [...channels]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([channel, count]) => ({ channel, count, share: rows.length ? count / rows.length : 0 })),
  };
}

// --- Activation funnel ----------------------------------------------------------

/** Engineers who signed up in the range, and how many have reached each step (and every one before it) since. */
export function funnel(range: Range, steps: readonly FunnelStep[] = FUNNEL_STEPS) {
  return shared(`funnel:${range.from.toISOString()}:${range.to.toISOString()}:${steps.join(",")}`, async () => {
    const marks = await testMarks();
    return funnelOf([...(await milestones(marks, { signedUp: range })).values()], steps);
  });
}

// --- Money ----------------------------------------------------------------------

export function money(range: Range, now: Date, months = 6) {
  const firstMonth = (() => {
    const d = new Date(`${ukDay(now).slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (months - 1));
    return d.toISOString().slice(0, 7);
  })();
  return shared(`money:${range.from.toISOString()}:${range.to.toISOString()}:${firstMonth}:${months}`, () => moneyFrom(range, firstMonth, months));
}

/** Collections by UK month and in the range: the same payments as the funnel's first payment and a customer's history. */
async function moneyFrom(range: Range, firstMonth: string, months: number) {
  const marks = await testMarks();
  const monthsFrom = ukMidnight(`${firstMonth}-01`);
  const paid = await payments(marks, { from: monthsFrom < range.from ? monthsFrom : range.from });
  const keys = Array.from({ length: months }, (_, i) => {
    const d = new Date(`${firstMonth}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d.toISOString().slice(0, 7);
  });
  // Real referrals only: neither side test data.
  const realReferral = { referrerId: { notIn: marks.engineers }, inviteeId: { notIn: marks.engineers } };
  const [earned, owed] = await Promise.all([
    prisma.referralEarning.aggregate({ where: { ...realReferral, createdAt: { gte: range.from, lt: range.to } }, _sum: { amountPence: true } }),
    prisma.referralEarning.aggregate({ where: { ...realReferral, transferId: null }, _sum: { amountPence: true } }),
  ]);
  return {
    months: keys.map((month) => ({ month, ...withShares(paymentTotals(paid.filter((p) => ukDay(p.paidAt).slice(0, 7) === month))) })),
    period: withShares(paymentTotals(paid.filter((p) => p.paidAt >= range.from && p.paidAt < range.to))),
    /** Referral payments (Matt, 4 Nov): earned in the range, and owed now (earned, not yet transferred). */
    referrals: { earnedPence: earned._sum.amountPence ?? 0, owedPence: owed._sum.amountPence ?? 0 },
  };
}

/** What went to engineers: collected after refunds and claims, less TradeSura's fee (their 80%). */
const withShares = <T extends { netPence: number; feePence: number }>(t: T) => ({ ...t, engineersPence: t.netPence - t.feePence });

// --- Health: cancellations and failed payments -----------------------------------

const REASON_LABELS: Record<string, string> = {
  too_expensive: "Too expensive",
  moving: "Moving house",
  not_using: "Not using it",
  unhappy: "Unhappy with the service",
  other: "Other",
};

export async function health({ from, to }: Range) {
  const marks = await testMarks();
  const [cancelled, activeAtStart, failed] = await Promise.all([
    prisma.plan.findMany({
      where: { cancelledAt: { gte: from, lt: to }, ...realPlanWhere(marks) },
      select: { cancellations: { orderBy: { createdAt: "desc" }, take: 1, select: { reason: true } } },
    }),
    customersOnPlans(from, marks),
    prisma.plan.findMany({
      where: { paymentFailedAt: { gte: from, lt: to }, ...realPlanWhere(marks) },
      select: { priceMonthlyPence: true, paymentRecoveredAt: true },
    }),
  ]);
  const reasons = new Map<string, number>();
  for (const p of cancelled) {
    const key = REASON_LABELS[p.cancellations[0]?.reason ?? ""] ?? "No reason given";
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const sum = (xs: { priceMonthlyPence: number | null }[]) => xs.reduce((n, x) => n + (x.priceMonthlyPence ?? 0), 0);
  const recovered = failed.filter((f) => f.paymentRecoveredAt);
  const outstanding = failed.filter((f) => !f.paymentRecoveredAt);
  return {
    cancellations: {
      count: cancelled.length,
      rate: activeAtStart ? cancelled.length / activeAtStart : 0,
      activeAtStart,
      topReasons: [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)).slice(0, 5),
    },
    failed: {
      count: failed.length,
      failedPence: sum(failed),
      recovered: recovered.length,
      recoveredPence: sum(recovered),
      outstanding: outstanding.length,
      outstandingPence: sum(outstanding),
      recoveryRate: failed.length ? recovered.length / failed.length : 0,
    },
  };
}

// --- What's waiting on the team (for the shell's badges) ---------------------------

export async function waiting() {
  const [verifications, memberPacks, cancelRequests] = await Promise.all([
    prisma.engineer.count({ where: { deletedAt: null, gasSafeNo: { not: null }, gasSafeVerifiedAt: null, gasSafeRejectedAt: null } }),
    prisma.engineer.count({ where: { packRequestedAt: { not: null }, packShippedAt: null, gasSafeVerifiedAt: { not: null }, pausedAt: null, bannedAt: null, deletedAt: null } }),
    prisma.cancelRequest.count({ where: { outcome: "pending" } }),
  ]);
  return { verifications, memberPacks, cancelRequests };
}
