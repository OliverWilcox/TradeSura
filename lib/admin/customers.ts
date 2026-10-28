import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { displayName } from "@/lib/engineer";
import { adminEvent } from "@/lib/admin-api/audit";
import { bounded, likeTerm } from "@/lib/admin-api/db";
import { notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { exactContactSearch, maskEmail, maskPhone } from "@/lib/admin/mask";

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
  if (q.q) {
    const contains = { contains: likeTerm(q.q), mode: "insensitive" as const };
    const contact = exactContactSearch(q.q);
    and.push({
      OR: [
        { firstName: contains },
        { lastName: contains },
        { properties: { some: { OR: [{ postcode: contains }, { addressLine1: contains }] } } },
        { plans: { some: { ref: { equals: q.q.trim().toUpperCase() } } } },
        ...(contact.email ? [{ email: { equals: contact.email, mode: "insensitive" as const } }] : []),
        ...(contact.phone ? [{ phone: contact.phone }] : []),
      ],
    });
  }
  return { AND: and };
}

/** The plan that best describes where a customer is now: live first, then the newest. */
function currentPlan<T extends { status: PlanStatus; createdAt: Date }>(plans: T[]): T | null {
  const rank: Record<PlanStatus, number> = { ACTIVE: 0, PAUSED: 1, PENDING: 2, CANCELLED: 3 };
  return [...plans].sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}

const LIST_INCLUDE = {
  engineer: { select: { id: true, tradingName: true, legalName: true, slug: true } },
  // The first home added; the postcode sort uses the same one.
  properties: { select: { town: true, postcode: true }, orderBy: { id: "asc" }, take: 1 },
  plans: {
    select: { id: true, ref: true, status: true, priceMonthlyPence: true, createdAt: true, activatedAt: true, paymentsCleared: true, paymentFailedAt: true, paymentRecoveredAt: true, tier: { select: { name: true } } },
  },
} satisfies Prisma.CustomerInclude;

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

export async function listCustomers(q: CustomerListQuery) {
  const where = listWhere(q);
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
  return { items: rows.map(listItem), page: q.page, size: q.size, total };
}

function listItem(c: Prisma.CustomerGetPayload<{ include: typeof LIST_INCLUDE }>) {
  const plan = currentPlan(c.plans);
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
          priceMonthlyPence: plan.priceMonthlyPence,
          startedAt: plan.activatedAt?.toISOString() ?? null,
          payment: plan.paymentFailedAt && !plan.paymentRecoveredAt ? ("failing" as const) : plan.paymentsCleared > 0 ? ("paid" as const) : ("none" as const),
        }
      : null,
    source: c.source,
    addedAt: c.createdAt.toISOString(),
  };
}

/** Every customer matching the list's filters, newest first, in batches: what a CSV export streams. */
export async function* exportCustomers(q: Omit<CustomerListQuery, "page" | "size" | "sort" | "dir">, batch = 500) {
  const where = listWhere({ ...q, page: 1, size: batch });
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
    yield rows.map(listItem);
    if (rows.length < batch) return;
    after = rows[rows.length - 1].id;
  }
}

export async function getCustomer(id: string) {
  const c = await prisma.customer.findFirst({
    where: { id, engineer: { deletedAt: null } },
    include: {
      engineer: { select: { id: true, tradingName: true, legalName: true, slug: true } },
      addedBy: { select: { id: true, firstName: true, lastName: true } },
      properties: {
        include: {
          appliances: { select: { id: true, make: true, model: true, type: true, installedAt: true, lastServicedAt: true } },
          passport: { select: { id: true } },
        },
      },
      plans: {
        orderBy: { createdAt: "desc" },
        include: {
          tier: { select: { name: true } },
          cancellations: { orderBy: { createdAt: "desc" }, select: { id: true, reason: true, offer: true, outcome: true, source: true, createdAt: true, resolvedAt: true } },
          ratings: { where: { ratedAt: { not: null } }, select: { id: true, stars: true, comment: true, ratedAt: true, removedAt: true } },
        },
      },
    },
  });
  if (!c) return null;
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  const payments = await customerPayments(c.plans.map((p) => p.stripeSubscriptionId).filter((s): s is string => !!s));
  return {
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim(),
    firstName: c.firstName,
    lastName: c.lastName,
    contact: { phone: maskPhone(c.phone), email: c.email ? maskEmail(c.email) : null, revealed: false },
    smsOptOut: c.smsOptOut,
    stripeCustomerId: c.plans.find((p) => p.stripeCustomerId)?.stripeCustomerId ?? c.stripeCustomerId,
    source: c.source,
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
      appliances: p.appliances.map((a) => ({ ...a, installedAt: iso(a.installedAt), lastServicedAt: iso(a.lastServicedAt) })),
    })),
    plans: c.plans.map((p) => ({
      id: p.id,
      ref: p.ref,
      status: p.status,
      tier: p.tier?.name ?? null,
      options: agreedOptions(p.agreedTier),
      priceMonthlyPence: p.priceMonthlyPence,
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
    payments,
  };
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

/** Anything recorded about the customer (admin actions, their plan's events), newest first. */
export async function customerActivity(id: string, q: { page: number; size: number }) {
  const where = { OR: [{ meta: { path: ["customerId"], equals: id } }, { meta: { path: ["subjectId"], equals: id } }] } satisfies Prisma.EventWhereInput;
  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { ts: "desc" }, skip: (q.page - 1) * q.size, take: q.size }),
    prisma.event.count({ where }),
  ]);
  const items = events.map((ev) => {
    const meta = (ev.meta ?? {}) as Record<string, unknown>;
    return { id: ev.id, name: ev.name, at: ev.ts.toISOString(), actor: { type: ev.actorType, id: ev.actorId, name: typeof meta.adminName === "string" ? meta.adminName : null } };
  });
  return { items, page: q.page, size: q.size, total };
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
