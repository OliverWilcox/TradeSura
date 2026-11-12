import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { brandName, displayName } from "@/lib/engineer";
import { appUrl } from "@/lib/app-url";
import { sendSms, smsConfigured } from "@/lib/sms";
import type { NotSent } from "@/lib/admin/verifications";
import { parseWinbackOffer, winbackBody, winbackSettingKey } from "@/lib/retention";
import { reasonList } from "@/lib/visit-reasons";
import { adminEvent } from "@/lib/admin-api/audit";
import { bounded, likeTerm } from "@/lib/admin-api/db";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { exactContactSearch, maskEmail, maskPhone } from "@/lib/admin/mask";
import { HIDE_ZERO_INVOICES, customerStatus, firstPaidByPlan, offers, payments, testMarks, type CustomerStatus, type TestMarks } from "@/lib/admin/metrics";
import { isSuppressed } from "@/lib/suppression";
import { testMarkOf } from "@/lib/admin/test-data";

// Homeowners for the admin API, across every engineer's book. Phone and email
// are masked unless revealed (recorded); the address shows, because support
// needs it to find the right home.

type PlanStatus = "PENDING" | "ACTIVE" | "PAUSED" | "CANCELLED";

/**
 * added: when they joined the engineer's book; since: when their current plan
 * started (or added, with no plan); price: their current plan's monthly
 * price; postcode: their first home's; engineer: the business name.
 */
export type CustomerSort = "added" | "name" | "since" | "postcode" | "engineer" | "price";

export type CustomerListQuery = {
  q?: string;
  engineerId?: string;
  plan?: "active" | "pending" | "paused" | "cancelled" | "none";
  /** failing: a payment failed and hasn't been recovered; paid: at least one payment cleared. */
  payment?: "failing" | "paid" | "none";
  cancelledFrom?: Date;
  cancelledTo?: Date;
  source?: string;
  /** Where they are with their current plan, by the metrics layer's customerStatus. */
  status?: CustomerStatus;
  sort?: CustomerSort;
  dir?: "asc" | "desc";
  page: number;
  size: number;
};

const PLAN_FILTER: Record<Exclude<CustomerListQuery["plan"], undefined | "none">, PlanStatus> = {
  active: "ACTIVE",
  pending: "PENDING",
  paused: "PAUSED",
  cancelled: "CANCELLED",
};

function listWhere(q: CustomerListQuery): Prisma.CustomerWhereInput {
  const and: Prisma.CustomerWhereInput[] = [{ engineer: { deletedAt: null } }];
  if (q.engineerId) and.push({ engineerId: q.engineerId });
  if (q.source) and.push({ source: q.source });
  if (q.plan === "none") and.push({ plans: { none: {} } });
  else if (q.plan) and.push({ plans: { some: { status: PLAN_FILTER[q.plan] } } });
  if (q.payment === "failing") and.push({ plans: { some: { paymentFailedAt: { not: null }, paymentRecoveredAt: null } } });
  else if (q.payment === "paid") and.push({ plans: { some: { paymentsCleared: { gte: 1 } } } });
  else if (q.payment === "none") and.push({ plans: { none: { paymentsCleared: { gte: 1 } } } });
  if (q.cancelledFrom || q.cancelledTo) {
    and.push({ plans: { some: { cancelledAt: { ...(q.cancelledFrom ? { gte: q.cancelledFrom } : {}), ...(q.cancelledTo ? { lt: q.cancelledTo } : {}) } } } });
  }
  if (q.q) and.push(customerSearch(q.q));
  return { AND: and };
}

/** What a search box matches: names, a home's postcode or first line, a plan reference, or a whole email or phone number. */
export function customerSearch(term: string): Prisma.CustomerWhereInput {
  const contains = { contains: likeTerm(term), mode: "insensitive" as const };
  const contact = exactContactSearch(term);
  return {
    OR: [
      { firstName: contains },
      { lastName: contains },
      { properties: { some: { OR: [{ postcode: contains }, { addressLine1: contains }] } } },
      { plans: { some: { ref: { equals: term.trim().toUpperCase() } } } },
      ...(contact.email ? [{ email: { equals: contact.email, mode: "insensitive" as const } }] : []),
      ...(contact.phone ? [{ phone: contact.phone }] : []),
    ],
  };
}

/** The plan that best describes where a customer is now: live first, then the newest. */
export function currentPlan<T extends { status: PlanStatus; createdAt: Date }>(plans: T[]): T | null {
  const rank: Record<PlanStatus, number> = { ACTIVE: 0, PAUSED: 1, PENDING: 2, CANCELLED: 3 };
  return [...plans].sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

const PLAN_SELECT = {
  id: true,
  ref: true,
  status: true,
  priceMonthlyPence: true,
  createdAt: true,
  activatedAt: true,
  cancelledAt: true,
  mandateStatus: true,
  linkOpenedAt: true,
  paymentsCleared: true,
  paymentFailedAt: true,
  paymentRecoveredAt: true,
  tier: { select: { name: true, priceMonthlyPence: true } },
  visitReason: true,
  cancellations: { orderBy: { createdAt: "desc" as const }, take: 1, select: { reason: true } },
} satisfies Prisma.PlanSelect;

/**
 * How the customer came to TradeSura (Matt, 4 Nov): from the engineer's
 * offer link when an offer went to them, whatever page they finished on;
 * otherwise as they were added: at the job (doorstep), the engineer's
 * website, or added to the engineer's book (contacts, an import, by hand).
 */
export type CustomerSource = "offer_link" | "at_the_job" | "website" | "added";
export function customerSource(source: string, offered: boolean): CustomerSource {
  if (offered) return "offer_link";
  return source === "doorstep" ? "at_the_job" : source === "web" ? "website" : "added";
}

/** Visit reasons by code, with the labels the app shows. */
const visitReasonLabels = () => reasonList().then((list) => new Map(list.map((r) => [r.reason, r.label])));

const LIST_INCLUDE = {
  engineer: { select: { id: true, tradingName: true, legalName: true, slug: true } },
  // The first home added; the postcode sort uses the same one.
  properties: { select: { town: true, postcode: true, _count: { select: { appliances: true } }, passport: { select: { _count: { select: { appliances: true } } } } }, orderBy: { id: "asc" }, take: 1 },
  plans: { select: PLAN_SELECT },
} satisfies Prisma.CustomerInclude;

type ListRow = Prisma.CustomerGetPayload<{ include: typeof LIST_INCLUDE }>;

/** No test marks: every plan, for working out a status the list shows (test rows are labelled, not hidden). */
const EVERYONE: TestMarks = { engineers: [], customers: [] };

/** What a list answer needs for its rows: who's test data, and each current plan's offer and payments. */
async function rowFacts(rows: ListRow[]) {
  const planIds = rows.flatMap((r) => r.plans.map((p) => p.id));
  const [marks, sent, paid, reasons] = await Promise.all([
    testMarks(),
    planIds.length ? offers(EVERYONE, { planIds }) : [],
    planIds.length ? payments(EVERYONE, { planIds }) : [],
    visitReasonLabels(),
  ]);
  return { marks, offerByPlan: new Map(sent.map((o) => [o.planId, o])), firstPaid: firstPaidByPlan(paid), reasons };
}
type RowFacts = Awaited<ReturnType<typeof rowFacts>>;

/** A plan's monthly price: what the customer agreed to, or until they pick, the plan they were offered. */
const planPrice = (p: { priceMonthlyPence: number | null; tier: { priceMonthlyPence: number } | null }) => p.priceMonthlyPence ?? p.tier?.priceMonthlyPence ?? null;

function statusOf(plan: ListRow["plans"][number] | null, facts: RowFacts): CustomerStatus {
  return customerStatus(plan, { offer: plan ? (facts.offerByPlan.get(plan.id) ?? null) : null, paid: plan ? facts.firstPaid.has(plan.id) : false });
}

type ComputedSort = "since" | "postcode" | "engineer" | "price";

/** The plan currentPlan() picks, per customer, in SQL: live first, then the newest. */
const CURRENT_PLAN = (ids: string[]) => Prisma.sql`
  SELECT DISTINCT ON ("customerId") "customerId" AS id, "priceMonthlyPence" AS price, "activatedAt"
  FROM "Plan" WHERE "customerId" = ANY(${ids})
  ORDER BY "customerId", CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 WHEN 'PENDING' THEN 2 ELSE 3 END, "createdAt" DESC`;

/** One ordered page of the given customers, by a value the list shows. Blanks sort last either way. */
async function computedPage(ids: string[], sort: ComputedSort, dir: "asc" | "desc", skip: number, take: number): Promise<string[]> {
  if (!ids.length) return [];
  const d = dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const join = {
    since: Prisma.sql`LEFT JOIN (${CURRENT_PLAN(ids)}) cp ON cp.id = c.id`,
    price: Prisma.sql`LEFT JOIN (${CURRENT_PLAN(ids)}) cp ON cp.id = c.id`,
    postcode: Prisma.sql`LEFT JOIN (SELECT DISTINCT ON ("customerId") "customerId" AS id, postcode FROM "Property" WHERE "customerId" = ANY(${ids}) ORDER BY "customerId", id) h ON h.id = c.id`,
    engineer: Prisma.sql`JOIN "Engineer" e ON e.id = c."engineerId"`,
  }[sort];
  const value = {
    since: Prisma.sql`COALESCE(cp."activatedAt", c."createdAt")`,
    price: Prisma.sql`COALESCE(cp.price, 0)`,
    postcode: Prisma.sql`upper(h.postcode)`,
    engineer: Prisma.sql`lower(COALESCE(NULLIF(trim(e."tradingName"), ''), NULLIF(trim(e."legalName"), ''), e.slug))`,
  }[sort];
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "Customer" c ${join}
    WHERE c.id = ANY(${ids})
    ORDER BY ${value} ${d} NULLS LAST, c.id
    LIMIT ${take} OFFSET ${skip}`;
  return rows.map((r) => r.id);
}

/** The status filter: worked out for the customers the other filters match, as the rows show it. */
async function withStatus(where: Prisma.CustomerWhereInput, status: CustomerStatus | undefined): Promise<Prisma.CustomerWhereInput> {
  if (!status) return where;
  const rows = await prisma.customer.findMany({ where, include: LIST_INCLUDE });
  const facts = await rowFacts(rows);
  return { AND: [where, { id: { in: rows.filter((r) => statusOf(currentPlan(r.plans), facts) === status).map((r) => r.id) } }] };
}

export async function listCustomers(q: CustomerListQuery) {
  const where = await withStatus(listWhere(q), q.status);
  const dir = q.dir ?? (q.sort === "name" || q.sort === "postcode" || q.sort === "engineer" ? "asc" : "desc");
  const skip = (q.page - 1) * q.size;
  let rows: Prisma.CustomerGetPayload<{ include: typeof LIST_INCLUDE }>[];
  let total: number;
  if (q.sort === "since" || q.sort === "postcode" || q.sort === "engineer" || q.sort === "price") {
    // Every match's ID, then one ordered page of them.
    const all = (await prisma.customer.findMany({ where, select: { id: true } })).map((r) => r.id);
    const pageIds = await computedPage(all, q.sort, dir, skip, q.size);
    const found = await prisma.customer.findMany({ where: { id: { in: pageIds } }, include: LIST_INCLUDE });
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = pageIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
    total = all.length;
  } else {
    [rows, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: q.sort === "name" ? [{ lastName: dir }, { firstName: dir }, { id: "asc" }] : [{ createdAt: dir }, { id: "asc" }],
        skip,
        take: q.size,
        include: LIST_INCLUDE,
      }),
      prisma.customer.count({ where }),
    ]);
  }
  const facts = await rowFacts(rows);
  return { items: rows.map((r) => listItem(r, facts)), page: q.page, size: q.size, total };
}

function listItem(c: ListRow, facts: RowFacts) {
  const plan = currentPlan(c.plans);
  const firstPaid = c.plans.map((p) => facts.firstPaid.get(p.id)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    engineer: { id: c.engineer.id, business: displayName(c.engineer) },
    town: c.properties[0]?.town ?? null,
    postcode: c.properties[0]?.postcode ?? null,
    contact: { phone: maskPhone(c.phone), email: c.email ? maskEmail(c.email) : null },
    plan: plan
      ? {
          id: plan.id,
          ref: plan.ref,
          name: plan.tier?.name ?? null,
          status: plan.status,
          priceMonthlyPence: planPrice(plan),
          startedAt: plan.activatedAt?.toISOString() ?? null,
          cancelledAt: plan.cancelledAt?.toISOString() ?? null,
          cancelReason: plan.status === "CANCELLED" ? (plan.cancellations[0]?.reason ?? null) : null,
          payment: plan.paymentFailedAt && !plan.paymentRecoveredAt ? ("failing" as const) : facts.firstPaid.has(plan.id) ? ("paid" as const) : ("none" as const),
        }
      : null,
    status: statusOf(plan, facts),
    firstPaymentAt: firstPaid?.toISOString() ?? null,
    isTest: facts.marks.customers.includes(c.id) || facts.marks.engineers.includes(c.engineerId),
    source: customerSource(c.source, c.plans.some((p) => facts.offerByPlan.has(p.id))),
    visitReason: plan?.visitReason ? (facts.reasons.get(plan.visitReason) ?? plan.visitReason) : null,
    /** A boiler on their home, registered by the engineer or on the Home Passport. */
    boilerRegistered: c.properties.some((p) => p._count.appliances > 0 || (p.passport?._count.appliances ?? 0) > 0),
    addedAt: c.createdAt.toISOString(),
  };
}

/** Every customer matching the list's filters, newest first, in batches: what a CSV export streams. */
export async function* exportCustomers(q: Omit<CustomerListQuery, "page" | "size" | "sort" | "dir">, batch = 500) {
  const where = await withStatus(listWhere({ ...q, page: 1, size: batch }), q.status);
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.customer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: batch,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      include: LIST_INCLUDE,
    });
    if (!rows.length) return;
    const facts = await rowFacts(rows);
    yield rows.map((r) => listItem(r, facts));
    if (rows.length < batch) return;
    after = rows[rows.length - 1].id;
  }
}

export async function getCustomer(id: string) {
  const c = await prisma.customer.findFirst({
    where: { id, engineer: { deletedAt: null } },
    include: {
      engineer: { select: { id: true, tradingName: true, legalName: true, slug: true, leftAt: true, bannedAt: true } },
      addedBy: { select: { id: true, firstName: true, lastName: true } },
      properties: {
        include: {
          appliances: { select: { id: true, make: true, model: true, type: true, installedAt: true, lastServicedAt: true } },
          passport: {
            select: {
              id: true,
              appliances: { select: { id: true, make: true, model: true, type: true, installedAt: true, lastServicedAt: true } },
              files: { orderBy: { createdAt: "desc" }, select: { id: true, kind: true, label: true, contentType: true, createdAt: true } },
              _count: { select: { records: true } },
            },
          },
        },
      },
      plans: {
        orderBy: { createdAt: "desc" },
        include: {
          tier: { select: { name: true, priceMonthlyPence: true } },
          cancellations: { orderBy: { createdAt: "desc" }, select: { id: true, reason: true, offer: true, outcome: true, source: true, createdAt: true, resolvedAt: true } },
          ratings: { where: { ratedAt: { not: null } }, select: { id: true, stars: true, comment: true, ratedAt: true, removedAt: true } },
        },
      },
    },
  });
  if (!c) return null;
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const planIds = c.plans.map((p) => p.id);
  const [history, marks, sent, paid, suppressed, test, reasons, winBackTexts] = await Promise.all([
    customerPayments(c.plans.map((p) => p.stripeSubscriptionId).filter((s): s is string => !!s)),
    testMarks(),
    planIds.length ? offers(EVERYONE, { planIds }) : [],
    planIds.length ? payments(EVERYONE, { planIds }) : [],
    isSuppressed("sms", c.phone),
    testMarkOf("customer", id),
    visitReasonLabels(),
    // The automatic win-backs (30 days after cancelling, and before winter) and any an admin sent.
    planIds.length
      ? prisma.outboundSms.findMany({
          where: { OR: planIds.flatMap((pid) => [{ cancelKey: { startsWith: `winback:${pid}` } }, { cancelKey: `winback:admin:${pid}` }]) },
          orderBy: { sendAfter: "asc" },
          select: { id: true, cancelKey: true, status: true, sendAfter: true, sentAt: true, deliveredAt: true, failedAt: true },
        })
      : [],
  ]);
  const offerByPlan = new Map(sent.map((o) => [o.planId, o]));
  const firstPaid = firstPaidByPlan(paid);
  const current = currentPlan(c.plans);
  const shown = HIDE_ZERO_INVOICES ? history.filter((h) => h.amountPence > 0) : history;
  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    firstName: c.firstName,
    lastName: c.lastName,
    contact: { phone: maskPhone(c.phone), email: c.email ? maskEmail(c.email) : null, revealed: false },
    smsOptOut: c.smsOptOut || suppressed,
    status: customerStatus(current, { offer: current ? (offerByPlan.get(current.id) ?? null) : null, paid: current ? firstPaid.has(current.id) : false }),
    firstPaymentAt: paid[0]?.paidAt.toISOString() ?? null,
    test: { ...test, viaEngineer: marks.engineers.includes(c.engineerId) },
    winBack: winBackFor({ optedOut: c.smsOptOut || suppressed, plan: current, engineer: c.engineer }),
    stripeCustomerId: c.plans.find((p) => p.stripeCustomerId)?.stripeCustomerId ?? c.stripeCustomerId,
    source: customerSource(c.source, c.plans.some((p) => offerByPlan.has(p.id))),
    addedAt: c.createdAt.toISOString(),
    addedBy: c.addedBy ? { id: c.addedBy.id, name: [c.addedBy.firstName, c.addedBy.lastName].filter(Boolean).join(" ") } : null,
    engineer: { id: c.engineer.id, business: displayName(c.engineer) },
    homes: c.properties.map((p) => ({
      id: p.id,
      addressLine1: p.addressLine1,
      addressLine2: p.addressLine2,
      town: p.town,
      postcode: p.postcode,
      hasPassport: Boolean(p.passport),
      appliances: [...p.appliances, ...(p.passport?.appliances.filter((a) => !p.appliances.some((b) => b.id === a.id)) ?? [])].map((a) => ({
        ...a,
        installedAt: iso(a.installedAt),
        lastServicedAt: iso(a.lastServicedAt),
      })),
      /** The Home Passport: photos and documents engineers added, and service records. Frozen, not removed, once the plan ends. */
      passport: p.passport
        ? {
            files: p.passport.files.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
            records: p.passport._count.records,
            frozen: !!current && current.status === "CANCELLED",
          }
        : null,
    })),
    winBacks: winBackTexts.map((t) => ({
      id: t.id,
      kind: t.cancelKey?.startsWith("winback:admin:") ? ("admin" as const) : t.cancelKey?.endsWith(":winter") ? ("winter" as const) : ("30_days" as const),
      status: t.status,
      due: t.sendAfter.toISOString(),
      sentAt: iso(t.sentAt),
      deliveredAt: iso(t.deliveredAt),
      failedAt: iso(t.failedAt),
    })),
    plans: c.plans.map((p) => ({
      id: p.id,
      ref: p.ref,
      status: p.status,
      tier: p.tier?.name ?? null,
      visitReason: p.visitReason ? (reasons.get(p.visitReason) ?? p.visitReason) : null,
      options: agreedOptions(p.agreedTier),
      priceMonthlyPence: planPrice(p),
      offer: offerByPlan.has(p.id) ? { channel: offerByPlan.get(p.id)!.channel, sentAt: offerByPlan.get(p.id)!.sentAt.toISOString(), delivery: offerByPlan.get(p.id)!.delivery } : null,
      firstPaymentAt: iso(firstPaid.get(p.id) ?? null),
      billingInterval: p.billingInterval,
      createdAt: p.createdAt.toISOString(),
      activatedAt: iso(p.activatedAt),
      coolingOffEndsAt: iso(p.coolingOffEndsAt),
      serviceStartsAt: iso(p.serviceStartsAt),
      paymentsCleared: p.paymentsCleared,
      mandateStatus: p.mandateStatus,
      paymentFailedAt: iso(p.paymentFailedAt),
      pausedUntil: iso(p.pausedUntil),
      cancelRequestedAt: iso(p.cancelRequestedAt),
      cancelEffectiveAt: iso(p.cancelEffectiveAt),
      cancelledAt: iso(p.cancelledAt),
      cancellations: p.cancellations.map((x) => ({ ...x, createdAt: x.createdAt.toISOString(), resolvedAt: iso(x.resolvedAt) })),
      ratings: p.ratings.map((r) => ({ ...r, ratedAt: iso(r.ratedAt), removedAt: iso(r.removedAt) })),
    })),
    payments: shown,
    /** £0 trial invoices left out of `payments` (HIDE_ZERO_INVOICES). */
    zeroInvoicesHidden: history.length - shown.length,
  };
}

/**
 * Whether a win-back text can go: only to someone whose plan has ended, who
 * hasn't opted out of texts, with an engineer still on TradeSura.
 */
function winBackFor(c: { optedOut: boolean; plan: { status: string } | null; engineer: { leftAt: Date | null; bannedAt: Date | null } }) {
  if (c.optedOut) return { available: false, reason: "They've opted out of texts." };
  if (!c.plan || c.plan.status !== "CANCELLED") return { available: false, reason: "Only for customers whose plan has been cancelled." };
  if (c.engineer.leftAt || c.engineer.bannedAt) return { available: false, reason: "Their engineer isn't taking customers on TradeSura." };
  return { available: true, reason: null };
}

/** What the customer agreed to: the options in the plan as it was when they signed up. */
function agreedOptions(agreed: unknown): string[] {
  const clauses = agreed && typeof agreed === "object" ? (agreed as { clauses?: { title?: unknown }[] }).clauses : undefined;
  return Array.isArray(clauses) ? clauses.map((c) => (typeof c.title === "string" ? c.title : "")).filter(Boolean) : [];
}

/**
 * The customer's payments, newest first, from the invoice events the Stripe
 * webhook stores (paid and failed). An invoice belongs to the customer when
 * its subscription is one of their plans'.
 */
async function customerPayments(subscriptionIds: string[]) {
  if (!subscriptionIds.length) return [];
  const rows = await bounded(prisma.$queryRaw<{ id: string; type: string; amount: bigint | null; fee: bigint | null; at: bigint | null; created: Date }[]>`
    SELECT payload->'data'->'object'->>'id' AS id, type,
      COALESCE((payload->'data'->'object'->>'amount_paid')::bigint, (payload->'data'->'object'->>'amount_due')::bigint) AS amount,
      (payload->'data'->'object'->>'application_fee_amount')::bigint AS fee,
      (payload->'data'->'object'->'status_transitions'->>'paid_at')::bigint AS at,
      "processedAt" AS created
    FROM "StripeWebhookEvent"
    WHERE type IN ('invoice.paid', 'invoice.payment_failed')
      AND COALESCE(payload->'data'->'object'->'parent'->'subscription_details'->>'subscription', payload->'data'->'object'->>'subscription') = ANY(${subscriptionIds})
    ORDER BY "processedAt" DESC
    LIMIT 36`);
  return rows.map((r) => ({
    id: r.id,
    status: r.type === "invoice.paid" ? ("paid" as const) : ("failed" as const),
    amountPence: Number(r.amount ?? 0),
    feePence: r.fee === null ? null : Number(r.fee),
    at: r.at ? new Date(Number(r.at) * 1000).toISOString() : r.created.toISOString(),
  }));
}

/** Shown from the invoices instead, so the timeline and the payment history list the same payments (QA-04). */
const INVOICE_EVENTS = new Set(["payment_confirmed", "payment_failed"]);

/**
 * What's happened with the customer, newest first: anything recorded about
 * them or any of their plans (the offer, picking a plan, the Direct Debit,
 * pauses, cancelling and why, and admin actions), with each cancellation
 * request's retention offer and choice. Payments are the invoices the payment
 * history shows, from the same source with the same £0 rule (the app records
 * only the first as an event). Opening the link, the plan starting, a failed
 * payment recovered and the plan ending come from the plan itself where no
 * event says so (QA-04).
 */
export async function customerActivity(id: string, q: { page: number; size: number }) {
  const plans = await prisma.plan.findMany({
    where: { customerId: id },
    select: {
      id: true,
      stripeSubscriptionId: true,
      linkOpenedAt: true,
      activatedAt: true,
      paymentRecoveredAt: true,
      cancelledAt: true,
      cancellations: { select: { id: true, reason: true, offer: true, outcome: true, source: true, createdAt: true, resolvedAt: true } },
    },
  });
  const where = {
    OR: [
      { meta: { path: ["customerId"], equals: id } },
      { meta: { path: ["subjectId"], equals: id } },
      { actorType: "CUSTOMER" as const, actorId: id },
      ...plans.map((p) => ({ meta: { path: ["planId"], equals: p.id } })),
    ],
  } satisfies Prisma.EventWhereInput;
  const [events, invoices] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { ts: "desc" }, take: 500 }),
    customerPayments(plans.map((p) => p.stripeSubscriptionId).filter((s): s is string => !!s)),
  ]);
  const detail = (d: Partial<{ channel: string | null; reason: string | null; amountPence: number | null; offer: string | null; outcome: string | null }> = {}) => ({
    channel: null,
    reason: null,
    amountPence: null,
    offer: null,
    outcome: null,
    ...d,
  });
  const recorded = new Set(events.map((ev) => `${ev.name}:${(ev.meta as { planId?: unknown } | null)?.planId ?? ""}`));
  const items = [
    ...events
      .filter((ev) => !INVOICE_EVENTS.has(ev.name))
      .map((ev) => {
        const meta = (ev.meta ?? {}) as Record<string, unknown>;
        const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : null);
        return {
          id: ev.id,
          name: ev.name,
          at: ev.ts,
          actor: { type: ev.actorType, id: ev.actorId, name: str("adminName") },
          detail: detail({ channel: str("channel"), reason: str("reason"), amountPence: typeof meta.amountPence === "number" ? meta.amountPence : null }),
        };
      }),
    ...(HIDE_ZERO_INVOICES ? invoices.filter((i) => i.amountPence > 0) : invoices).map((i) => ({
      id: `invoice:${i.id}`,
      name: i.status === "paid" ? "payment_confirmed" : "payment_failed",
      at: new Date(i.at),
      actor: { type: "SYSTEM" as const, id: null, name: null },
      detail: detail({ amountPence: i.amountPence }),
    })),
    // What the plan's own dates show, where the app didn't record an event for it.
    ...plans.flatMap((p) =>
      (
        [
          ["signup_opened", p.linkOpenedAt, "CUSTOMER"],
          ["plan_live", p.activatedAt, "SYSTEM"],
          ["payment_recovered", p.paymentRecoveredAt, "SYSTEM"],
          ["plan_cancelled", p.cancelledAt, "SYSTEM"],
        ] as const
      )
        .filter(([name, at]) => at && !recorded.has(`${name}:${p.id}`))
        .map(([name, at, type]) => ({ id: `plan:${p.id}:${name}`, name, at: at!, actor: { type, id: null, name: null }, detail: detail() })),
    ),
    // The retention screen: what they were offered and what they chose.
    ...plans.flatMap((p) =>
      p.cancellations.flatMap((x) => [
        {
          id: x.id,
          name: "cancel_requested",
          at: x.createdAt,
          actor: { type: x.source === "engineer_logged" ? ("ENGINEER" as const) : ("CUSTOMER" as const), id: null, name: null },
          detail: detail({ reason: x.reason, offer: x.offer, outcome: x.outcome }),
        },
        // The app texts and pushes the engineer the moment a customer starts to cancel (lib/cancel-plan.ts).
        ...(x.source === "engineer_logged"
          ? []
          : [{ id: `${x.id}:alerted`, name: "engineer_alerted", at: new Date(x.createdAt.getTime() + 1), actor: { type: "SYSTEM" as const, id: null, name: null }, detail: detail({ reason: x.reason }) }]),
      ]),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  const page = items.slice((q.page - 1) * q.size, q.page * q.size).map((i) => ({ ...i, at: i.at.toISOString() }));
  return { items: page, page: q.page, size: q.size, total: items.length };
}

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** The customer's phone number and email, or just one (`field`). Every reveal is recorded, with the field if given. */
export async function revealCustomerContact(admin: AdminPrincipal, id: string, opts: { field?: "email" | "phone" } = {}) {
  const c = await prisma.customer.findFirst({ where: { id, engineer: { deletedAt: null } }, select: { phone: true, email: true, engineerId: true } });
  if (!c) throw notFound("There's no customer with that ID.");
  await adminEvent(admin, "admin_contact_revealed", { subjectType: "customer", subjectId: id, engineerId: c.engineerId, ...(opts.field ? { field: opts.field } : {}) });
  if (opts.field === "email") return { email: c.email };
  if (opts.field === "phone") return { phone: c.phone };
  return { phone: c.phone, email: c.email };
}

export async function customerExists(id: string) {
  return (await prisma.customer.count({ where: { id, engineer: { deletedAt: null } } })) > 0;
}

/**
 * Texts a customer whose plan has ended a link to rejoin it: the app's own
 * win-back message, with the engineer's win-back offer, from the engineer's
 * name. lib/sms.ts adds the STOP line, honours opt-outs and holds it until
 * 08:00 if it's late. Says what happened: sent, queued for the morning, or
 * not sent and why (QA-05). Recorded either way.
 */
export async function sendWinBack(admin: AdminPrincipal, id: string) {
  const c = await prisma.customer.findFirst({
    where: { id, engineer: { deletedAt: null } },
    include: { engineer: true, plans: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, createdAt: true, rejoinToken: true } } },
  });
  if (!c) throw notFound("There's no customer with that ID.");
  const plan = currentPlan(c.plans);
  const optedOut = c.smsOptOut || (await isSuppressed("sms", c.phone));
  const check = winBackFor({ optedOut, plan, engineer: c.engineer });
  if (!check.available || !plan) throw conflict(check.reason ?? "This customer can't be sent a win-back text.");
  let token = plan.rejoinToken;
  if (!token) {
    token = randomBytes(16).toString("base64url");
    await prisma.plan.update({ where: { id: plan.id }, data: { rejoinToken: token } });
  }
  const setting = await prisma.appSetting.findUnique({ where: { key: winbackSettingKey(c.engineerId) } });
  const body = winbackBody({ firstName: c.firstName, brand: brandName(c.engineer), offer: parseWinbackOffer(setting?.value), link: `${appUrl()}/rejoin/${token}`, winter: false });
  const result = await sendSms({ engineerId: c.engineerId, to: c.phone, body, messageClass: "MARKETING", consentBasis: "marketing", cancelKey: `winback:admin:${plan.id}` });
  if ("reason" in result && result.reason === "opted-out") throw conflict("They've opted out of texts.");
  const status = !result.sent ? ("queued" as const) : result.delivered ? ("sent" as const) : ("not_sent" as const);
  const notSent: NotSent | null = status === "not_sent" ? (smsConfigured() ? "refused" : "not_configured") : null;
  await adminEvent(admin, status === "not_sent" ? "customer_win_back_failed" : "customer_win_back_sent", {
    customerId: id,
    planId: plan.id,
    engineerId: c.engineerId,
    status,
    ...(notSent ? { notSent } : {}),
  });
  return { status, notSent };
}
