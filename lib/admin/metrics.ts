import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { computeApplicationFeePence } from "@/lib/stripe";
import { bounded } from "@/lib/admin-api/db";

// The admin's numbers, each defined once. Every count and status the admin
// app shows (dashboard cards, the funnel, lists, record pages) comes from
// here, over the same range and with the same filter, so one question always
// gets one answer:
//
// - Real: engineers are business owners (not staff) whose account still
//   exists; anything tied to an engineer or customer marked as test data
//   (AdminTestMark), or to a deleted engineer, is left out everywhere.
// - An offer is a plan an engineer sent (an `offer_sent` event). It's
//   delivered once the customer opens the link, or when it went by text (the
//   app hands texts to Twilio and doesn't record a refusal yet). A WhatsApp
//   offer is shared by the engineer from their phone, so until the link is
//   opened there's no sign it arrived: "not confirmed". Failed is a refusal
//   the app has recorded, none yet.
// - A payment is a paid Stripe invoice for more than £0 (the £0 cooling-off
//   trial invoice "pays" before any mandate exists), on a real plan.
//
// Ranges are instants: [from, to).

export type Range = { from: Date; to: Date };

/** An engineer is active when they've sent a delivered offer in this many days. */
export const ACTIVE_WINDOW_DAYS = 7;

/**
 * Hide £0 invoices from a customer's payment history. They're Stripe's
 * cooling-off trial invoices; once the trial set-up changes, set this to false.
 * They never count as a payment either way.
 */
export const HIDE_ZERO_INVOICES = true;

const DAY_MS = 86_400_000;

// --- Test data ------------------------------------------------------------------

export type TestMarks = { engineers: string[]; customers: string[] };

/** Everyone marked as test data. A short list, loaded once per answer. */
export async function testMarks(): Promise<TestMarks> {
  const rows = await prisma.adminTestMark.findMany({ select: { subjectType: true, subjectId: true } });
  return {
    engineers: rows.filter((r) => r.subjectType === "engineer").map((r) => r.subjectId),
    customers: rows.filter((r) => r.subjectType === "customer").map((r) => r.subjectId),
  };
}

/** Engineers who count: owners, account not deleted, not test data. */
export const realEngineerWhere = (marks: TestMarks) =>
  ({ ownerId: null, deletedAt: null, id: { notIn: marks.engineers } }) satisfies Prisma.EngineerWhereInput;

/** Plans that count: their engineer's and customer's. */
export const realPlanWhere = (marks: TestMarks) =>
  ({ engineer: { deletedAt: null }, engineerId: { notIn: marks.engineers }, customerId: { notIn: marks.customers } }) satisfies Prisma.PlanWhereInput;

/** The same, for raw SQL over a "Plan" row aliased `p` joined to its "Engineer" `e`. */
const realPlanSql = (marks: TestMarks) =>
  Prisma.sql`e."deletedAt" IS NULL AND NOT (p."engineerId" = ANY(${marks.engineers}::text[])) AND NOT (p."customerId" = ANY(${marks.customers}::text[]))`;

// --- Payments -------------------------------------------------------------------

export type Payment = { invoiceId: string; amountPence: number; feePence: number; paidAt: Date; planId: string; engineerId: string; customerId: string };

type PaymentRow = { invoiceId: string; amount: bigint; fee: bigint | null; paidAt: Date; planId: string; engineerId: string; customerId: string };

/**
 * Paid invoices over £0 on real plans, oldest first, from the events the
 * Stripe webhook stores. An invoice belongs to the plan whose subscription it
 * bills (or, as the webhook falls back, the plan its subscription names). The
 * fee is the one Stripe took; where the webhook was too late to set it, the
 * app's own helper works it out the same way (20 %, rounded down).
 */
export async function payments(marks: TestMarks, opts: { from?: Date; to?: Date; engineerIds?: string[]; planIds?: string[] } = {}): Promise<Payment[]> {
  const rows = await bounded(prisma.$queryRaw<PaymentRow[]>`
    WITH inv AS (
      SELECT DISTINCT ON (COALESCE(o->>'id', ev.id))
        COALESCE(o->>'id', ev.id) AS "invoiceId",
        (o->>'amount_paid')::bigint AS amount,
        (o->>'application_fee_amount')::bigint AS fee,
        COALESCE(to_timestamp((o->'status_transitions'->>'paid_at')::bigint), ev."processedAt") AS "paidAt",
        COALESCE(o->'parent'->'subscription_details'->>'subscription', o->>'subscription') AS sub,
        o->'parent'->'subscription_details'->'metadata'->>'planId' AS "metaPlan"
      FROM (SELECT id, "processedAt", payload->'data'->'object' AS o FROM "StripeWebhookEvent" WHERE type = 'invoice.paid') ev
      ORDER BY COALESCE(o->>'id', ev.id), ev."processedAt"
    )
    SELECT inv."invoiceId", inv.amount, inv.fee, inv."paidAt", p.id AS "planId", p."engineerId", p."customerId"
    FROM inv
    JOIN LATERAL (SELECT id, "engineerId", "customerId" FROM "Plan" WHERE "stripeSubscriptionId" = inv.sub OR id = inv."metaPlan" LIMIT 1) p ON true
    JOIN "Engineer" e ON e.id = p."engineerId"
    WHERE inv.amount > 0 AND ${realPlanSql(marks)}
      ${opts.from ? Prisma.sql`AND inv."paidAt" >= ${opts.from}` : Prisma.empty}
      ${opts.to ? Prisma.sql`AND inv."paidAt" < ${opts.to}` : Prisma.empty}
      ${opts.engineerIds ? Prisma.sql`AND p."engineerId" = ANY(${opts.engineerIds}::text[])` : Prisma.empty}
      ${opts.planIds ? Prisma.sql`AND p.id = ANY(${opts.planIds}::text[])` : Prisma.empty}
    ORDER BY inv."paidAt"`);
  return rows.map((r) => {
    const amountPence = Number(r.amount);
    return {
      invoiceId: r.invoiceId,
      amountPence,
      feePence: r.fee === null ? computeApplicationFeePence(amountPence) : Number(r.fee),
      paidAt: r.paidAt,
      planId: r.planId,
      engineerId: r.engineerId,
      customerId: r.customerId,
    };
  });
}

/** Totals of some payments: how many, how much, and TradeSura's fee on them. */
export function paymentTotals(ps: Payment[]) {
  const gross = ps.reduce((n, p) => n + p.amountPence, 0);
  // Refunds and Direct Debit claims aren't among the events the webhook stores yet.
  return { count: ps.length, grossPence: gross, refundedPence: 0, claimedPence: 0, netPence: gross, feePence: ps.reduce((n, p) => n + p.feePence, 0) };
}

/** When each plan was first paid for, from payments(). */
export function firstPaidByPlan(ps: Payment[]): Map<string, Date> {
  const first = new Map<string, Date>();
  for (const p of ps) if (!first.has(p.planId)) first.set(p.planId, p.paidAt);
  return first;
}

// --- Offers ---------------------------------------------------------------------

export type Delivery = "delivered" | "failed" | "unconfirmed";
export type OfferChannel = "sms" | "whatsapp";

export type Offer = { planId: string; engineerId: string; customerId: string; channel: OfferChannel; sentAt: Date; openedAt: Date | null; delivery: Delivery };

/** Whether an offer arrived, as far as anything recorded shows (see the top of this file). */
export function deliveryOf(o: { channel: string | null; openedAt: Date | null; failedAt?: Date | null }): Delivery {
  if (o.openedAt) return "delivered";
  if (o.failedAt) return "failed";
  return o.channel === "whatsapp" ? "unconfirmed" : "delivered";
}

type OfferRow = { planId: string; engineerId: string; customerId: string; channel: string | null; sentAt: Date; openedAt: Date | null };

/** Offers on real plans, by when they were sent (or for the given plans, whenever sent). */
export async function offers(marks: TestMarks, opts: { from?: Date; to?: Date; planIds?: string[]; engineerIds?: string[] } = {}): Promise<Offer[]> {
  const rows = await bounded(prisma.$queryRaw<OfferRow[]>`
    SELECT p.id AS "planId", p."engineerId", p."customerId", s.channel, s.ts AS "sentAt", p."linkOpenedAt" AS "openedAt"
    FROM (
      SELECT DISTINCT ON (meta->>'planId') meta->>'planId' AS "planId", meta->>'channel' AS channel, ts
      FROM "Event"
      WHERE name = 'offer_sent'
        ${opts.from ? Prisma.sql`AND ts >= ${opts.from}` : Prisma.empty}
        ${opts.to ? Prisma.sql`AND ts < ${opts.to}` : Prisma.empty}
        ${opts.planIds ? Prisma.sql`AND meta->>'planId' = ANY(${opts.planIds}::text[])` : Prisma.empty}
      ORDER BY meta->>'planId', ts
    ) s
    JOIN "Plan" p ON p.id = s."planId"
    JOIN "Engineer" e ON e.id = p."engineerId"
    WHERE ${realPlanSql(marks)}
      ${opts.engineerIds ? Prisma.sql`AND p."engineerId" = ANY(${opts.engineerIds}::text[])` : Prisma.empty}
    ORDER BY s.ts`);
  return rows.map((r) => {
    const channel: OfferChannel = r.channel === "whatsapp" ? "whatsapp" : "sms";
    return { ...r, channel, delivery: deliveryOf({ channel, openedAt: r.openedAt }) };
  });
}

/** Offers counted the way every headline counts them: delivered, with the others beside. */
export function offerCounts(os: Offer[]) {
  return {
    delivered: os.filter((o) => o.delivery === "delivered").length,
    failed: os.filter((o) => o.delivery === "failed").length,
    unconfirmed: os.filter((o) => o.delivery === "unconfirmed").length,
  };
}

// --- Engineers ------------------------------------------------------------------

/**
 * Engineers active at an instant: real, and sent a delivered offer in the
 * ACTIVE_WINDOW_DAYS before it. The set, so lists and cards agree.
 */
export async function activeEngineerIds(marks: TestMarks, at: Date, engineerIds?: string[]): Promise<Set<string>> {
  const since = new Date(at.getTime() - ACTIVE_WINDOW_DAYS * DAY_MS);
  const [os, real] = await Promise.all([
    offers(marks, { from: since, to: at, engineerIds }),
    prisma.engineer.findMany({ where: { ...realEngineerWhere(marks), ...(engineerIds ? { id: { in: engineerIds, notIn: marks.engineers } } : {}) }, select: { id: true } }),
  ]);
  const ids = new Set(real.map((r) => r.id));
  return new Set(os.filter((o) => o.delivery === "delivered" && ids.has(o.engineerId)).map((o) => o.engineerId));
}

/** Verified engineers at an instant: real, approved before it, and neither deleted nor banned by then. */
export function verifiedEngineerCount(marks: TestMarks, at: Date) {
  return prisma.engineer.count({
    where: {
      ownerId: null,
      id: { notIn: marks.engineers },
      gasSafeVerifiedAt: { lt: at },
      AND: [{ OR: [{ deletedAt: null }, { deletedAt: { gte: at } }] }, { OR: [{ bannedAt: null }, { bannedAt: { gte: at } }] }],
    },
  });
}

// --- The activation steps -------------------------------------------------------

export type FunnelStep = "signed_up" | "verified" | "plan_live" | "payments_set_up" | "first_payment";

/**
 * The funnel's steps, in order. Each step counts only engineers who reached
 * every step before it, so none can be bigger than the last. Reorder or add
 * here; every reader follows.
 */
export const FUNNEL_STEPS: readonly FunnelStep[] = ["signed_up", "verified", "plan_live", "payments_set_up", "first_payment"];

export const STEP_LABELS: Record<FunnelStep, string> = {
  signed_up: "Signed up",
  verified: "Verified",
  plan_live: "First plan live",
  payments_set_up: "Payments set up",
  first_payment: "First payment",
};

/** Where one engineer is: whether each step is reached, and when (if that's recorded). */
export type Milestones = Record<FunnelStep, { reached: boolean; at: Date | null }>;

type MilestoneRow = {
  id: string;
  createdAt: Date;
  verifiedAt: Date | null;
  tierLive: boolean;
  planLiveAt: Date | null;
  chargesEnabled: boolean;
  paymentsAt: Date | null;
};

/**
 * Each step for some engineers, from the same sources everywhere:
 * - verified: approved in the verification queue;
 * - first plan live: one of their own plans published (on sale now or since stopped);
 * - payments set up: their Stripe account can take payments now, the same
 *   flag the record's Payments panel shows (with the date Stripe first said so);
 * - first payment: their first payment, as payments() counts them.
 */
export async function milestones(marks: TestMarks, where: { ids: string[] } | { signedUp: Range }): Promise<Map<string, Milestones>> {
  const scope =
    "ids" in where
      ? Prisma.sql`e.id = ANY(${where.ids}::text[])`
      : Prisma.sql`e."ownerId" IS NULL AND e."deletedAt" IS NULL AND NOT (e.id = ANY(${marks.engineers}::text[]))
          AND e."createdAt" >= ${where.signedUp.from} AND e."createdAt" < ${where.signedUp.to}`;
  const rows = await bounded(prisma.$queryRaw<MilestoneRow[]>`
    WITH e AS (SELECT id, "createdAt", "gasSafeVerifiedAt", "stripeChargesEnabled" FROM "Engineer" e WHERE ${scope}),
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
    )
    SELECT e.id, e."createdAt", e."gasSafeVerifiedAt" AS "verifiedAt", tiers.id IS NOT NULL AS "tierLive", plan_live.at AS "planLiveAt",
      e."stripeChargesEnabled" AS "chargesEnabled", payments.at AS "paymentsAt"
    FROM e
    LEFT JOIN payments ON payments.id = e.id
    LEFT JOIN plan_live ON plan_live.id = e.id
    LEFT JOIN tiers ON tiers.id = e.id`);
  const paid = rows.length ? await payments(marks, { engineerIds: rows.map((r) => r.id) }) : [];
  const firstPaid = new Map<string, Date>();
  for (const p of paid) if (!firstPaid.has(p.engineerId)) firstPaid.set(p.engineerId, p.paidAt);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        signed_up: { reached: true, at: r.createdAt },
        verified: { reached: Boolean(r.verifiedAt), at: r.verifiedAt },
        plan_live: { reached: r.tierLive || Boolean(r.planLiveAt), at: r.planLiveAt },
        payments_set_up: { reached: r.chargesEnabled, at: r.chargesEnabled ? r.paymentsAt : null },
        first_payment: { reached: firstPaid.has(r.id), at: firstPaid.get(r.id) ?? null },
      },
    ]),
  );
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * The funnel over some engineers' milestones: at each step, those who
 * reached it and every step before it, and the median days from the step
 * before (where both dates are known).
 */
export function funnelOf(all: Milestones[], steps: readonly FunnelStep[] = FUNNEL_STEPS) {
  let still = all;
  const start = all.length;
  return steps.map((step, i) => {
    const before = still.length;
    still = still.filter((m) => m[step].reached);
    const prev = steps[i - 1];
    const gaps = prev
      ? still.flatMap((m) => {
          const a = m[prev].at;
          const b = m[step].at;
          return a && b && b >= a ? [(b.getTime() - a.getTime()) / DAY_MS] : [];
        })
      : [];
    return {
      key: step,
      label: STEP_LABELS[step],
      count: still.length,
      ofStart: start ? still.length / start : 0,
      fromPrevious: before ? still.length / before : 0,
      medianDaysFromPrevious: i === 0 ? null : median(gaps),
    };
  });
}

// --- Customers ------------------------------------------------------------------

/**
 * Where a customer is with a plan, from the offer to the end:
 * offered (sent, failed, not confirmed or opened) → thinking about it (picked
 * a plan or opened the Direct Debit form, not finished) → started Direct
 * Debit (mandate in place, nothing collected yet: the cooling-off period) →
 * active (paid at least once; or paused, or a payment failing) → cancelled.
 */
export type CustomerStatus =
  | "offer_sent"
  | "offer_failed"
  | "offer_unconfirmed"
  | "offer_opened"
  | "thinking"
  | "dd_started"
  | "active"
  | "payment_failing"
  | "paused"
  | "cancelled"
  | "no_plan";

export type StatusPlan = {
  status: "PENDING" | "ACTIVE" | "PAUSED" | "CANCELLED";
  mandateStatus: string | null;
  priceMonthlyPence: number | null;
  linkOpenedAt: Date | null;
  paymentFailedAt: Date | null;
  paymentRecoveredAt: Date | null;
};

/** `offer` is the plan's offer (null for a plan the customer started on the website); `paid`, whether payments() has one for it. */
export function customerStatus(plan: StatusPlan | null, facts: { offer: { delivery: Delivery } | null; paid: boolean }): CustomerStatus {
  if (!plan) return "no_plan";
  if (plan.status === "CANCELLED") return "cancelled";
  if (plan.status === "PAUSED") return "paused";
  if (plan.status === "ACTIVE") {
    if (plan.paymentFailedAt && !plan.paymentRecoveredAt) return "payment_failing";
    return facts.paid ? "active" : "dd_started";
  }
  // Not finished signing up: how far they got. Picking a plan sets its price
  // and opening the Direct Debit form marks the mandate pending.
  if (plan.mandateStatus === "pending" || plan.priceMonthlyPence !== null) return "thinking";
  if (plan.linkOpenedAt) return "offer_opened";
  if (facts.offer?.delivery === "failed") return "offer_failed";
  if (facts.offer?.delivery === "unconfirmed") return "offer_unconfirmed";
  return "offer_sent";
}
