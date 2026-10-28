import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { TRADESURA_FEE_RATE } from "@/lib/clauses";
import { addDays, daysBetween, ukDay, ukMidnight, weekStart } from "@/lib/admin/time";
import { bounded, shared } from "@/lib/admin-api/db";

// The admin dashboard's sections, from the live database, one function per
// section so the admin app can stream them. Each follows the definition the
// admin app shows beside it (its features/dashboard/definitions.ts), and
// returns the same shape as the admin app's metric functions. Ranges are
// instants: [from, to).
//
// Collections come from the Stripe events the webhook stores
// (StripeWebhookEvent, invoice.paid). Refunds and Direct Debit claims aren't
// among the events it receives yet, so they count as nothing for now.
//
// The heavy sections (sign-ups by day, the funnel, money) run with a
// statement timeout, and callers asking for the same range at the same time
// share one run (lib/admin-api/db.ts).

export type Range = { from: Date; to: Date };

export const ACTIVE_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Plans live at an instant: started before it and not ended by it. */
function liveAt(at: Date) {
  return { activatedAt: { lt: at }, OR: [{ cancelledAt: null }, { cancelledAt: { gte: at } }] };
}

/**
 * Customers with a live plan at an instant (mandate not still pending), counted
 * in the database rather than loaded. Like the Prisma query this replaced, a
 * plan with no mandate status isn't counted (`<>` is never true for NULL).
 */
async function customersOnPlans(at: Date): Promise<number> {
  const [row] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT "customerId") AS n FROM "Plan"
    WHERE "activatedAt" < ${at} AND ("cancelledAt" IS NULL OR "cancelledAt" >= ${at})
      AND "mandateStatus" <> 'pending'`;
  return Number(row.n);
}

// --- Core: offers per engineer per week --------------------------------------

export type WeekValue = { weekStart: string; offers: number; activeEngineers: number; value: number };

/** Offers sent in a UK week ÷ verified engineers whose account was open at any point in it. */
async function week(weekFrom: string, until?: Date): Promise<WeekValue> {
  const start = ukMidnight(weekFrom);
  const end = until ?? ukMidnight(addDays(weekFrom, 7));
  const [offers, engineers] = await Promise.all([
    prisma.plan.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.engineer.count({
      where: {
        ownerId: null,
        gasSafeVerifiedAt: { lt: end },
        AND: [{ OR: [{ deletedAt: null }, { deletedAt: { gte: start } }] }, { OR: [{ bannedAt: null }, { bannedAt: { gte: start } }] }],
      },
    }),
  ]);
  return { weekStart: weekFrom, offers, activeEngineers: engineers, value: engineers ? offers / engineers : 0 };
}

export async function core(now: Date, weeks = 12) {
  const thisWeek = weekStart(ukDay(now));
  const starts = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * (weeks - i)));
  const [trend, weekToDate] = await Promise.all([Promise.all(starts.map((w) => week(w))), week(thisWeek, now)]);
  const lastWeek = trend[trend.length - 1];
  const previousWeek = trend[trend.length - 2];
  return { lastWeek, previousWeek, weekToDate, change: lastWeek.value - previousWeek.value, trend };
}

// --- Headline numbers ---------------------------------------------------------

export async function stats({ from, to }: Range) {
  const activeSince = new Date(to.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS);
  const [signups, verifiedInPeriod, verifiedAllTime, active, plansLive, customers, sent, converted] = await Promise.all([
    prisma.engineer.count({ where: { ownerId: null, createdAt: { gte: from, lt: to } } }),
    prisma.engineer.count({ where: { gasSafeVerifiedAt: { gte: from, lt: to } } }),
    prisma.engineer.count({ where: { gasSafeVerifiedAt: { lt: to }, OR: [{ deletedAt: null }, { deletedAt: { gte: to } }] } }),
    prisma.engineer.count({
      where: {
        ownerId: null,
        deletedAt: null,
        bannedAt: null,
        pausedAt: null,
        leftAt: null,
        gasSafeVerifiedAt: { lt: to },
        plans: { some: { createdAt: { gte: activeSince, lt: to } } },
      },
    }),
    prisma.plan.count({ where: liveAt(to) }),
    customersOnPlans(to),
    prisma.plan.count({ where: { createdAt: { gte: from, lt: to } } }),
    prisma.plan.count({ where: { createdAt: { gte: from, lt: to }, activatedAt: { not: null } } }),
  ]);
  return {
    signups,
    verified: { inPeriod: verifiedInPeriod, allTime: verifiedAllTime },
    active,
    plansLive,
    customers,
    offers: sent,
    conversion: { sent, converted, rate: sent ? converted / sent : 0 },
  };
}

// --- Sign-ups -----------------------------------------------------------------

export async function signups({ from, to }: Range) {
  const [days, channels] = await Promise.all([
    bounded(prisma.$queryRaw<{ day: string; n: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day, count(*) AS n
      FROM "Engineer" WHERE "ownerId" IS NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1`),
    bounded(prisma.$queryRaw<{ channel: string | null; n: bigint }[]>`
      SELECT attribution->>'heardVia' AS channel, count(*) AS n
      FROM "Engineer" WHERE "ownerId" IS NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY 1 ORDER BY 2 DESC, 1`),
  ]);
  const byDay = new Map(days.map((d) => [d.day, Number(d.n)]));
  const total = channels.reduce((n, c) => n + Number(c.n), 0);
  // Every UK day the range touches, from its first instant to its last.
  const lastDay = ukDay(new Date(to.getTime() - 1));
  return {
    byDay: daysBetween(ukDay(from), addDays(lastDay, 1)).map((date) => ({ date, count: byDay.get(date) ?? 0 })),
    channels: channels.map((c) => ({ channel: c.channel ?? "other", count: Number(c.n), share: total ? Number(c.n) / total : 0 })),
  };
}

// --- Activation funnel ----------------------------------------------------------

export const FUNNEL_LABELS = ["Signed up", "Payments set up", "First plan live", "First customer", "First payment"] as const;

type FunnelRow = { signedUp: Date; paymentsReady: boolean; payments: Date | null; planLive: Date | null; tierLive: boolean; firstCustomer: Date | null; firstPayment: Date | null };

/**
 * Engineers who signed up in the range, and when each first reached every
 * step. Each step is worked out once for the whole group (grouped, then
 * joined) rather than once per engineer, so it reads each kind of event once
 * through the Event (name, ts) index instead of once per sign-up: about 0.2 s
 * for a year of sign-ups at a million events, against minutes before.
 */
async function funnelRows({ from, to }: Range): Promise<FunnelRow[]> {
  return bounded(prisma.$queryRaw<FunnelRow[]>`
    WITH e AS (
      SELECT id, "createdAt", "stripeChargesEnabled" FROM "Engineer"
      WHERE "ownerId" IS NULL AND "deletedAt" IS NULL AND "createdAt" >= ${from} AND "createdAt" < ${to}
    ),
    payments AS (
      SELECT "actorId" AS id, min(ts) AS at FROM "Event"
      WHERE name = 'stripe_onboarded' AND "actorId" IN (SELECT id FROM e) GROUP BY 1
    ),
    plan_live AS (
      SELECT "actorId" AS id, min(ts) AS at FROM "Event"
      WHERE name = 'plan_live' AND "actorType" = 'ENGINEER' AND "actorId" IN (SELECT id FROM e) GROUP BY 1
    ),
    tiers AS (
      SELECT DISTINCT "engineerId" AS id FROM "PlanTier" WHERE status IN ('LIVE', 'STOPPED') AND "engineerId" IN (SELECT id FROM e)
    ),
    customers AS (
      SELECT "engineerId" AS id, min("activatedAt") AS at FROM "Plan" WHERE "engineerId" IN (SELECT id FROM e) GROUP BY 1
    ),
    paid AS (
      SELECT meta->>'engineerId' AS id, min(ts) AS at FROM "Event"
      WHERE name = 'payment_confirmed' AND meta->>'engineerId' IN (SELECT id FROM e) GROUP BY 1
    )
    SELECT e."createdAt" AS "signedUp", e."stripeChargesEnabled" AS "paymentsReady", payments.at AS payments,
      plan_live.at AS "planLive", tiers.id IS NOT NULL AS "tierLive", customers.at AS "firstCustomer", paid.at AS "firstPayment"
    FROM e
    LEFT JOIN payments ON payments.id = e.id
    LEFT JOIN plan_live ON plan_live.id = e.id
    LEFT JOIN tiers ON tiers.id = e.id
    LEFT JOIN customers ON customers.id = e.id
    LEFT JOIN paid ON paid.id = e.id`);
}

/** Engineers who signed up in the range, and how many have reached each step since. */
export function funnel(range: Range) {
  return shared(`funnel:${range.from.toISOString()}:${range.to.toISOString()}`, () => funnelSteps(range));
}

async function funnelSteps(range: Range) {
  const rows = await funnelRows(range);
  const gap = (a: Date | null, b: Date | null) => (a && b && b >= a ? (b.getTime() - a.getTime()) / DAY_MS : null);
  const reached = [
    rows.map(() => true),
    rows.map((r) => r.paymentsReady || Boolean(r.payments)),
    rows.map((r) => r.tierLive || Boolean(r.planLive)),
    rows.map((r) => Boolean(r.firstCustomer)),
    rows.map((r) => Boolean(r.firstPayment)),
  ];
  const gaps = [
    [],
    rows.map((r) => gap(r.signedUp, r.payments)),
    rows.map((r) => gap(r.payments ?? r.signedUp, r.planLive)),
    rows.map((r) => gap(r.planLive, r.firstCustomer)),
    rows.map((r) => gap(r.firstCustomer, r.firstPayment)),
  ];
  const start = rows.length;
  return FUNNEL_LABELS.map((label, i) => {
    const count = reached[i].filter(Boolean).length;
    const prev = i === 0 ? start : reached[i - 1].filter(Boolean).length;
    return {
      label,
      count,
      ofStart: start ? count / start : 0,
      fromPrevious: prev ? count / prev : 0,
      medianDaysFromPrevious: i === 0 ? null : median(gaps[i].filter((g): g is number => g !== null)),
    };
  });
}

// --- Money ----------------------------------------------------------------------

export type CollectedTotals = { count: number; grossPence: number; refundedPence: number; claimedPence: number; netPence: number; feePence: number };

type PaidRow = { month: string; count: bigint; gross: bigint | null; fee: bigint | null };

function totals(r: { count: bigint | number; gross: bigint | number | null; fee: bigint | number | null } | undefined): CollectedTotals {
  const gross = Number(r?.gross ?? 0);
  const fee = r?.fee === null || r?.fee === undefined ? Math.floor(gross * TRADESURA_FEE_RATE) : Number(r.fee);
  return { count: Number(r?.count ?? 0), grossPence: gross, refundedPence: 0, claimedPence: 0, netPence: gross, feePence: fee };
}

// Paid invoices, from the stored webhook events. The fee is the application
// fee Stripe took on each invoice. A fixed SQL fragment; values only ever go
// in as parameters.
const PAID_AT = Prisma.sql`to_timestamp((payload->'data'->'object'->'status_transitions'->>'paid_at')::bigint)`;

export function money(range: Range, now: Date, months = 6) {
  const firstMonth = (() => {
    const d = new Date(`${ukDay(now).slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (months - 1));
    return d.toISOString().slice(0, 7);
  })();
  return shared(`money:${range.from.toISOString()}:${range.to.toISOString()}:${firstMonth}:${months}`, () => moneyFrom(range, firstMonth, months));
}

async function moneyFrom({ from, to }: Range, firstMonth: string, months: number) {
  const [byMonth, period] = await Promise.all([
    bounded(prisma.$queryRaw<PaidRow[]>`
      SELECT to_char(${PAID_AT} AT TIME ZONE 'Europe/London', 'YYYY-MM') AS month, count(*) AS count,
        sum((payload->'data'->'object'->>'amount_paid')::bigint) AS gross,
        sum((payload->'data'->'object'->>'application_fee_amount')::bigint) AS fee
      FROM "StripeWebhookEvent"
      WHERE type = 'invoice.paid' AND ${PAID_AT} >= ${ukMidnight(`${firstMonth}-01`)}
      GROUP BY 1`),
    bounded(prisma.$queryRaw<Omit<PaidRow, "month">[]>`
      SELECT count(*) AS count, sum((payload->'data'->'object'->>'amount_paid')::bigint) AS gross,
        sum((payload->'data'->'object'->>'application_fee_amount')::bigint) AS fee
      FROM "StripeWebhookEvent"
      WHERE type = 'invoice.paid' AND ${PAID_AT} >= ${from} AND ${PAID_AT} < ${to}`),
  ]);
  const found = new Map(byMonth.map((m) => [m.month, m]));
  const keys = Array.from({ length: months }, (_, i) => {
    const d = new Date(`${firstMonth}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return d.toISOString().slice(0, 7);
  });
  return { months: keys.map((month) => ({ month, ...totals(found.get(month)) })), period: totals(period[0]) };
}

// --- Health: cancellations and failed payments -----------------------------------

const REASON_LABELS: Record<string, string> = {
  too_expensive: "Too expensive",
  moving: "Moving house",
  not_using: "Not using it",
  unhappy: "Unhappy with the service",
  other: "Other",
};

export async function health({ from, to }: Range) {
  const [cancelled, activeAtStart, failed] = await Promise.all([
    prisma.plan.findMany({
      where: { cancelledAt: { gte: from, lt: to } },
      select: { cancellations: { orderBy: { createdAt: "desc" }, take: 1, select: { reason: true } } },
    }),
    customersOnPlans(from),
    prisma.plan.findMany({
      where: { paymentFailedAt: { gte: from, lt: to } },
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
