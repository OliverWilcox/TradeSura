import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { TRADESURA_FEE_RATE } from "@/lib/clauses";
import { displayName } from "@/lib/engineer";
import { appUrl } from "@/lib/app-url";
import { standingState } from "@/lib/verification-state";
import { adminEvent } from "@/lib/admin-api/audit";
import { bounded, likeTerm } from "@/lib/admin-api/db";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { personName, verificationStatus } from "@/lib/admin/verifications";
import { exactContactSearch, maskEmail, maskPhone } from "@/lib/admin/mask";

// Engineers for the admin API: find them, see one in full, and change their
// standing. Pause and ban are the fields the app already enforces everywhere
// (offers, texts, town pages, enquiries — Build Guide v2 Part 6.4), so setting
// them here takes effect on the engineer's next request. Contact details are
// masked unless revealed, and every reveal is recorded.

export type EngineerStatus = "active" | "paused" | "banned" | "left";

const live = { deletedAt: null } satisfies Prisma.EngineerWhereInput;

const STATUS_WHERE: Record<EngineerStatus, Prisma.EngineerWhereInput> = {
  active: { bannedAt: null, pausedAt: null, leftAt: null },
  paused: { bannedAt: null, pausedAt: { not: null } },
  banned: { bannedAt: { not: null } },
  left: { leftAt: { not: null } },
};

const VERIFICATION_WHERE = {
  verified: { gasSafeVerifiedAt: { not: null } },
  pending: { gasSafeNo: { not: null }, gasSafeVerifiedAt: null, gasSafeRejectedAt: null },
  rejected: { gasSafeVerifiedAt: null, gasSafeRejectedAt: { not: null } },
  not_submitted: { gasSafeNo: null, gasSafeVerifiedAt: null },
} satisfies Record<string, Prisma.EngineerWhereInput>;

export type VerificationFilter = keyof typeof VERIFICATION_WHERE;

export function engineerStatus(e: { bannedAt: Date | null; pausedAt: Date | null; leftAt: Date | null }): EngineerStatus {
  if (e.bannedAt) return "banned";
  if (e.leftAt) return "left";
  if (e.pausedAt) return "paused";
  return "active";
}

function channelOf(attribution: unknown): string | null {
  const heardVia = attribution && typeof attribution === "object" ? (attribution as { heardVia?: unknown }).heardVia : null;
  return typeof heardVia === "string" ? heardVia : null;
}

const LIST_SELECT = {
  id: true,
  slug: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  businessType: true,
  town: true,
  ownerId: true,
  attribution: true,
  bannedAt: true,
  pausedAt: true,
  leftAt: true,
  gasSafeNo: true,
  gasSafeVerifiedAt: true,
  gasSafeRejectedAt: true,
  stripeChargesEnabled: true,
  createdAt: true,
  _count: {
    select: {
      customers: true,
      plans: { where: { status: "ACTIVE" } },
      tiers: { where: { status: "LIVE" } },
    },
  },
} satisfies Prisma.EngineerSelect;

/** How far through getting started an engineer is: the furthest step they've reached. */
export type ActivationStep = "signed_up" | "payments" | "plan" | "customer" | "payout";

const hasLiveTier = { tiers: { some: { status: { in: ["LIVE", "STOPPED"] } } } } satisfies Prisma.EngineerWhereInput;
const hasCustomer = { plans: { some: { activatedAt: { not: null } } } } satisfies Prisma.EngineerWhereInput;
const hasPayment = { plans: { some: { paymentsCleared: { gte: 1 } } } } satisfies Prisma.EngineerWhereInput;

const STEP_WHERE: Record<ActivationStep, Prisma.EngineerWhereInput> = {
  signed_up: { stripeChargesEnabled: false, NOT: hasLiveTier },
  payments: { stripeChargesEnabled: true, NOT: hasLiveTier },
  plan: { ...hasLiveTier, NOT: hasCustomer },
  customer: { ...hasCustomer, NOT: hasPayment },
  payout: hasPayment,
};

/**
 * plans: customer plans live now (ACTIVE); tiers: the engineer's own plans on
 * sale (LIVE); customers: everyone on their book; customersOnPlans: customers
 * with an active or paused plan; lastOffer: their latest plan offer.
 */
export type EngineerSort = "joined" | "name" | "business" | "plans" | "tiers" | "customers" | "customersOnPlans" | "lastOffer";

export type EngineerListQuery = {
  q?: string;
  status?: EngineerStatus;
  verification?: VerificationFilter;
  step?: ActivationStep;
  town?: string;
  type?: "sole_trader" | "ltd" | "partnership";
  channel?: string;
  staff?: "owners" | "staff";
  joinedFrom?: Date;
  joinedTo?: Date;
  sort?: EngineerSort;
  dir?: "asc" | "desc";
  page: number;
  size: number;
};

function listWhere(q: EngineerListQuery): Prisma.EngineerWhereInput {
  const and: Prisma.EngineerWhereInput[] = [live];
  if (q.status) and.push(STATUS_WHERE[q.status]);
  if (q.verification) and.push(VERIFICATION_WHERE[q.verification]);
  if (q.type) and.push({ businessType: q.type });
  if (q.step) and.push(STEP_WHERE[q.step]);
  if (q.town) and.push({ town: { equals: q.town, mode: "insensitive" } });
  if (q.channel) and.push({ attribution: { path: ["heardVia"], equals: q.channel } });
  if (q.staff) and.push(q.staff === "staff" ? { ownerId: { not: null } } : { ownerId: null });
  if (q.joinedFrom || q.joinedTo) and.push({ createdAt: { ...(q.joinedFrom ? { gte: q.joinedFrom } : {}), ...(q.joinedTo ? { lt: q.joinedTo } : {}) } });
  if (q.q) {
    const contains = { contains: likeTerm(q.q), mode: "insensitive" as const };
    const digits = q.q.replace(/\D/g, "");
    const contact = exactContactSearch(q.q);
    and.push({
      OR: [
        { firstName: contains },
        { lastName: contains },
        { tradingName: contains },
        { legalName: contains },
        { slug: contains },
        { town: contains },
        { postcode: contains },
        ...(digits.length >= 3 ? [{ gasSafeNo: { contains: digits } }, { companyNumber: { contains: digits } }] : []),
        ...(contact.email ? [{ email: { equals: contact.email, mode: "insensitive" as const } }] : []),
        ...(contact.phone ? [{ phone: contact.phone }] : []),
      ],
    });
  }
  return { AND: and };
}

/** Sorts Prisma can order by itself. */
function listOrder(q: EngineerListQuery): Prisma.EngineerOrderByWithRelationInput[] {
  const dir = q.dir ?? (q.sort === "name" ? "asc" : "desc");
  switch (q.sort) {
    case "name":
      return [{ lastName: dir }, { firstName: dir }, { id: "asc" }];
    case "customers":
      return [{ customers: { _count: dir } }, { id: "asc" }];
    default:
      return [{ createdAt: dir }, { id: "asc" }];
  }
}

type ComputedSort = "business" | "plans" | "tiers" | "customersOnPlans" | "lastOffer";
const COMPUTED_SORTS = new Set<EngineerSort>(["business", "plans", "tiers", "customersOnPlans", "lastOffer"]);

/** The business name as displayName() shows it. */
const BUSINESS_SQL = Prisma.sql`lower(COALESCE(NULLIF(trim(e."tradingName"), ''), NULLIF(trim(e."legalName"), ''), e.slug))`;

/**
 * One page of the given engineers, ordered by a value worked out from their
 * plans (grouped once, then joined), or by the business name as shown. Each
 * value is the one the list shows in that column. A count of none sorts as 0;
 * no offer yet sorts last either way.
 */
async function computedPage(ids: string[], sort: ComputedSort, dir: "asc" | "desc", skip: number, take: number): Promise<string[]> {
  if (!ids.length) return [];
  const d = dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const values: Record<Exclude<ComputedSort, "business">, Prisma.Sql> = {
    plans: Prisma.sql`SELECT "engineerId" AS id, count(*) AS v FROM "Plan" WHERE status = 'ACTIVE' AND "engineerId" = ANY(${ids}) GROUP BY 1`,
    tiers: Prisma.sql`SELECT "engineerId" AS id, count(*) AS v FROM "PlanTier" WHERE status = 'LIVE' AND "engineerId" = ANY(${ids}) GROUP BY 1`,
    customersOnPlans: Prisma.sql`SELECT "engineerId" AS id, count(*) AS v FROM "Customer"
      WHERE "engineerId" = ANY(${ids}) AND id IN (SELECT "customerId" FROM "Plan" WHERE status IN ('ACTIVE', 'PAUSED')) GROUP BY 1`,
    lastOffer: Prisma.sql`SELECT "engineerId" AS id, max("createdAt") AS v FROM "Plan" WHERE "engineerId" = ANY(${ids}) GROUP BY 1`,
  };
  const rows =
    sort === "business"
      ? await prisma.$queryRaw<{ id: string }[]>`
          SELECT e.id FROM "Engineer" e WHERE e.id = ANY(${ids}) ORDER BY ${BUSINESS_SQL} ${d}, e.id LIMIT ${take} OFFSET ${skip}`
      : await prisma.$queryRaw<{ id: string }[]>`
          SELECT e.id FROM unnest(${ids}::text[]) AS e(id) LEFT JOIN (${values[sort]}) s ON s.id = e.id
          ORDER BY ${sort === "lastOffer" ? Prisma.sql`s.v ${d} NULLS LAST` : Prisma.sql`COALESCE(s.v, 0) ${d}`}, e.id
          LIMIT ${take} OFFSET ${skip}`;
  return rows.map((r) => r.id);
}

/** Customers with an active or paused plan, per engineer. */
async function customersOnPlans(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; n: bigint }[]>`
    SELECT "engineerId" AS id, count(*) AS n FROM "Customer"
    WHERE "engineerId" = ANY(${ids}) AND id IN (SELECT "customerId" FROM "Plan" WHERE status IN ('ACTIVE', 'PAUSED'))
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

export async function listEngineers(q: EngineerListQuery) {
  const where = listWhere(q);
  const skip = (q.page - 1) * q.size;
  let rows: ListRow[];
  let total: number;
  if (q.sort && COMPUTED_SORTS.has(q.sort)) {
    // Every match's ID (engineers number in the thousands), then one ordered page of them.
    const all = (await prisma.engineer.findMany({ where, select: { id: true } })).map((r) => r.id);
    const dir = q.dir ?? (q.sort === "business" ? "asc" : "desc");
    const pageIds = await computedPage(all, q.sort as ComputedSort, dir, skip, q.size);
    const found = await prisma.engineer.findMany({ where: { id: { in: pageIds } }, select: LIST_SELECT });
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = pageIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
    total = all.length;
  } else {
    [rows, total] = await Promise.all([
      prisma.engineer.findMany({ where, orderBy: listOrder(q), skip, take: q.size, select: LIST_SELECT }),
      prisma.engineer.count({ where }),
    ]);
  }
  return { items: await listItems(rows), page: q.page, size: q.size, total };
}

type ListRow = Prisma.EngineerGetPayload<{ select: typeof LIST_SELECT }>;

/** List rows as the API shows them, with each one's latest offer and customers on a plan. */
async function listItems(rows: ListRow[]) {
  const [lastOffers, onPlans] = await Promise.all([
    rows.length ? prisma.plan.groupBy({ by: ["engineerId"], where: { engineerId: { in: rows.map((r) => r.id) } }, _max: { createdAt: true } }) : [],
    customersOnPlans(rows.map((r) => r.id)),
  ]);
  const lastOfferBy = new Map(lastOffers.map((l) => [l.engineerId, l._max.createdAt]));
  return rows.map((r) => ({
    id: r.id,
    name: personName(r),
    business: displayName(r),
    slug: r.slug,
    town: r.town,
    type: r.businessType,
    channel: channelOf(r.attribution),
    isStaff: Boolean(r.ownerId),
    status: engineerStatus(r),
    verification: verificationStatus(r),
    paymentsReady: r.stripeChargesEnabled,
    plansLive: r._count.plans,
    tiersLive: r._count.tiers,
    customers: r._count.customers,
    customersOnPlans: onPlans.get(r.id) ?? 0,
    lastOfferAt: lastOfferBy.get(r.id)?.toISOString() ?? null,
    joinedAt: r.createdAt.toISOString(),
  }));
}

/**
 * Every engineer matching the list's filters, newest first, in batches: what
 * a CSV export streams. One query per batch, however many there are.
 */
export async function* exportEngineers(q: Omit<EngineerListQuery, "page" | "size" | "sort" | "dir">, batch = 500) {
  const where = listWhere({ ...q, page: 1, size: batch });
  let after: string | undefined;
  for (;;) {
    const rows = await prisma.engineer.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: batch,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: LIST_SELECT,
    });
    if (!rows.length) return;
    yield await listItems(rows);
    if (rows.length < batch) return;
    after = rows[rows.length - 1].id;
  }
}

/** The values the list can be filtered by: towns engineers work in and how they heard about TradeSura. */
export async function engineerFilterOptions() {
  const [towns, channels] = await Promise.all([
    prisma.engineer.findMany({ where: { ...live, town: { not: null } }, distinct: ["town"], select: { town: true }, orderBy: { town: "asc" } }),
    prisma.$queryRaw<{ channel: string }[]>`SELECT DISTINCT attribution->>'heardVia' AS channel FROM "Engineer" WHERE "deletedAt" IS NULL AND attribution->>'heardVia' IS NOT NULL ORDER BY 1`,
  ]);
  return { towns: towns.map((t) => t.town!), channels: channels.map((c) => c.channel) };
}

export async function getEngineer(id: string) {
  const e = await prisma.engineer.findFirst({
    where: { id, ...live },
    include: {
      owner: { select: { id: true, tradingName: true, legalName: true, slug: true } },
      staff: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, staffRemovedAt: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      referrer: { select: { id: true, tradingName: true, legalName: true, slug: true } },
      _count: { select: { customers: true, referrals: true, enquiries: true, stickers: true } },
    },
  });
  if (!e) return null;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [planCounts, tiersLive, mrr, earnings, ratings, tiers, recentCustomers, payouts, invitees, milestones, offersLast7Days, onPlans] = await Promise.all([
    prisma.plan.groupBy({ by: ["status"], where: { engineerId: id }, _count: { _all: true } }),
    prisma.planTier.count({ where: { engineerId: id, status: "LIVE" } }),
    prisma.plan.aggregate({ where: { engineerId: id, status: "ACTIVE" }, _sum: { priceMonthlyPence: true } }),
    prisma.referralEarning.aggregate({ where: { referrerId: id }, _sum: { amountPence: true } }),
    prisma.rating.aggregate({ where: { engineerId: id, ratedAt: { not: null }, removedAt: null }, _count: { _all: true }, _avg: { stars: true } }),
    prisma.planTier.findMany({
      where: { engineerId: id },
      orderBy: { sortOrder: "asc" },
      include: { clauses: { include: { clause: { select: { title: true, sortOrder: true } } } }, _count: { select: { plans: { where: { status: "ACTIVE" } } } } },
    }),
    prisma.customer.findMany({
      where: { engineerId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { properties: { select: { postcode: true }, take: 1 }, plans: { select: { status: true, activatedAt: true, createdAt: true } } },
    }),
    engineerPayouts(e.stripeAccountId),
    prisma.engineer.findMany({
      where: { referrerId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, tradingName: true, legalName: true, slug: true, createdAt: true, bannedAt: true, pausedAt: true, leftAt: true },
    }),
    engineerMilestones(id, e.stripeAccountId),
    prisma.plan.count({ where: { engineerId: id, createdAt: { gte: weekAgo } } }),
    customersOnPlans([id]),
  ]);
  const byInvitee = invitees.length
    ? await prisma.referralEarning.groupBy({ by: ["inviteeId"], where: { referrerId: id, inviteeId: { in: invitees.map((i) => i.id) } }, _sum: { amountPence: true }, _max: { ratePercent: true, createdAt: true } })
    : [];
  const paidOut = await prisma.referralEarning.aggregate({ where: { referrerId: id, transferId: { not: null } }, _sum: { amountPence: true } });
  const earnedBy = new Map(byInvitee.map((r) => [r.inviteeId, r]));
  const plans = { ACTIVE: 0, PENDING: 0, PAUSED: 0, CANCELLED: 0 };
  for (const p of planCounts) plans[p.status] = p._count._all;
  const monthly = mrr._sum.priceMonthlyPence ?? 0;
  const attribution = (e.attribution ?? {}) as { heardVia?: string; referralCode?: string; letterBatch?: string; variantCell?: string };
  return {
    id: e.id,
    name: personName(e),
    firstName: e.firstName,
    lastName: e.lastName,
    business: displayName(e),
    tradingName: e.tradingName,
    legalName: e.legalName,
    slug: e.slug,
    type: e.businessType,
    companyNumber: e.companyNumber,
    companyStatus: e.companyStatus,
    vatRegistered: e.vatRegistered,
    town: e.town,
    postcode: e.postcode,
    serviceArea: e.serviceArea,
    contact: { email: maskEmail(e.email), phone: e.phone ? maskPhone(e.phone) : null, revealed: false },
    joinedAt: e.createdAt.toISOString(),
    channel: attribution.heardVia ?? null,
    letterBatch: attribution.letterBatch ?? null,
    status: engineerStatus(e),
    standing: standingState(e),
    pause: e.pausedAt ? { at: e.pausedAt.toISOString(), reason: e.pauseReason } : null,
    ban: e.bannedAt ? { at: e.bannedAt.toISOString(), reason: e.banReason } : null,
    leftAt: e.leftAt?.toISOString() ?? null,
    verification: {
      status: verificationStatus(e),
      gasSafeNo: e.gasSafeNo,
      verifiedAt: e.gasSafeVerifiedAt?.toISOString() ?? null,
      rejectedAt: e.gasSafeRejectedAt?.toISOString() ?? null,
      rejectReason: e.gasSafeRejectReason,
    },
    payments: {
      accountId: e.stripeAccountId,
      connected: Boolean(e.stripeAccountId),
      detailsSubmitted: e.stripeDetailsSubmitted,
      chargesEnabled: e.stripeChargesEnabled,
      payoutsEnabled: e.stripePayoutsEnabled,
      needsInfo: Boolean(e.stripeAccountId && e.stripeDetailsSubmitted && !e.stripeChargesEnabled),
    },
    activation: {
      paymentsReady: e.stripeChargesEnabled,
      planLive: tiersLive > 0,
      firstCustomer: plans.ACTIVE + plans.PAUSED + plans.CANCELLED > 0,
      profilePublished: Boolean(e.profilePublishedAt),
      websiteConnected: Boolean(e.websiteConnectedAt),
    },
    counts: { customers: e._count.customers, customersOnPlans: onPlans.get(id) ?? 0, plans, tiersLive, enquiries: e._count.enquiries, stickers: e._count.stickers },
    money: { monthlyPlanValuePence: monthly, tradesuraFeePence: Math.floor(monthly * TRADESURA_FEE_RATE) },
    team: {
      owner: e.owner ? { id: e.owner.id, business: displayName(e.owner) } : null,
      staff: e.staff.map((s) => ({
        id: s.id,
        name: personName(s),
        email: maskEmail(s.email),
        phone: s.phone ? maskPhone(s.phone) : null,
        addedAt: s.createdAt.toISOString(),
        removedAt: s.staffRemovedAt?.toISOString() ?? null,
      })),
    },
    referrals: {
      code: e.slug,
      link: `${appUrl()}/join/${e.slug}`,
      referredBy: e.referrer ? { id: e.referrer.id, business: displayName(e.referrer) } : null,
      invited: e._count.referrals,
      earnedPence: earnings._sum.amountPence ?? 0,
      paidPence: paidOut._sum.amountPence ?? 0,
      owedPence: Math.max(0, (earnings._sum.amountPence ?? 0) - (paidOut._sum.amountPence ?? 0)),
      people: invitees.map((i) => ({
        id: i.id,
        business: displayName(i),
        joinedAt: i.createdAt.toISOString(),
        status: engineerStatus(i),
        earnedPence: earnedBy.get(i.id)?._sum.amountPence ?? 0,
        currentRatePercent: earnedBy.get(i.id)?._max.ratePercent ?? null,
      })),
    },
    tiers: tiers.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      priceMonthlyPence: t.priceMonthlyPence,
      options: t.clauses.map((c) => c.clause).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.title),
      customersOnIt: t._count.plans,
    })),
    recentCustomers: recentCustomers.map((c) => {
      const plan = [...c.plans].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        postcode: c.properties[0]?.postcode ?? null,
        planStatus: plan?.status ?? null,
        since: (plan?.activatedAt ?? c.createdAt).toISOString(),
      };
    }),
    payouts: payouts.recent,
    lifetimePayoutsPence: payouts.totalPence,
    milestones,
    offersLast7Days,
    ratings: { count: ratings._count._all, average: ratings._avg.stars === null ? null : Math.round(ratings._avg.stars * 10) / 10 },
    memberPack: { requestedAt: e.packRequestedAt?.toISOString() ?? null, shippedAt: e.packShippedAt?.toISOString() ?? null },
    website: { connectedAt: e.websiteConnectedAt?.toISOString() ?? null, host: e.websiteHost, widgetDisabledAt: e.widgetDisabledAt?.toISOString() ?? null },
    profile: { publishedAt: e.profilePublishedAt?.toISOString() ?? null, url: `${appUrl()}/${e.slug}` },
  };
}

export type EngineerDetail = NonNullable<Awaited<ReturnType<typeof getEngineer>>>;

/** Payouts to the engineer's bank, from the payout.paid events Stripe sends for their Connect account. */
async function engineerPayouts(accountId: string | null) {
  if (!accountId) return { recent: [], totalPence: 0 };
  const rows = await bounded(prisma.$queryRaw<{ id: string; amount: bigint; arrival: bigint | null; created: Date }[]>`
    SELECT payload->'data'->'object'->>'id' AS id,
           (payload->'data'->'object'->>'amount')::bigint AS amount,
           (payload->'data'->'object'->>'arrival_date')::bigint AS arrival,
           "processedAt" AS created
    FROM "StripeWebhookEvent"
    WHERE type = 'payout.paid' AND payload->>'account' = ${accountId}
    ORDER BY "processedAt" DESC`);
  return {
    recent: rows.slice(0, 26).map((r) => ({
      id: r.id,
      paidOn: r.arrival ? new Date(Number(r.arrival) * 1000).toISOString().slice(0, 10) : r.created.toISOString().slice(0, 10),
      amountPence: Number(r.amount),
      status: "paid" as const,
    })),
    totalPence: rows.reduce((n, r) => n + Number(r.amount), 0),
  };
}

/** When the engineer reached each step, from their events and plans. */
async function engineerMilestones(id: string, accountId: string | null) {
  const [row] = await bounded(prisma.$queryRaw<{ signedUp: Date; payments: Date | null; planLive: Date | null; firstCustomer: Date | null; firstPayout: Date | null }[]>`
    SELECT e."createdAt" AS "signedUp",
      (SELECT min(ts) FROM "Event" WHERE name = 'stripe_onboarded' AND "actorId" = e.id) AS payments,
      (SELECT min(ts) FROM "Event" WHERE name = 'plan_live' AND "actorType" = 'ENGINEER' AND "actorId" = e.id) AS "planLive",
      (SELECT min("activatedAt") FROM "Plan" WHERE "engineerId" = e.id) AS "firstCustomer",
      (SELECT min("processedAt") FROM "StripeWebhookEvent" WHERE type = 'payout.paid' AND payload->>'account' = ${accountId ?? ""}) AS "firstPayout"
    FROM "Engineer" e WHERE e.id = ${id}`);
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
  return {
    signedUpAt: iso(row?.signedUp),
    paymentsSetUpAt: iso(row?.payments),
    firstPlanLiveAt: iso(row?.planLive),
    firstCustomerAt: iso(row?.firstCustomer),
    firstPayoutAt: iso(row?.firstPayout),
  };
}

/** What happened to an engineer: their own actions and anything done to them, newest first. */
export async function engineerActivity(id: string, q: { page: number; size: number }) {
  const where: Prisma.EventWhereInput = { OR: [{ actorId: id }, { meta: { path: ["engineerId"], equals: id } }] };
  const [events, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { ts: "desc" }, skip: (q.page - 1) * q.size, take: q.size }),
    prisma.event.count({ where }),
  ]);
  const items = events.map((ev) => {
    const meta = (ev.meta ?? {}) as Record<string, unknown>;
    return {
      id: ev.id,
      name: ev.name,
      at: ev.ts.toISOString(),
      actor: { type: ev.actorType, id: ev.actorId, name: typeof meta.adminName === "string" ? meta.adminName : null },
      reason: typeof meta.reason === "string" ? meta.reason : null,
    };
  });
  return { items, page: q.page, size: q.size, total };
}

/**
 * The engineer's email and phone number, or one of their staff's (who must be
 * on this engineer's team). Every reveal is recorded against the engineer
 * whose record it was revealed on, with the staff member and field if given.
 */
export async function revealEngineerContact(admin: AdminPrincipal, id: string, opts: { staffId?: string; field?: "email" | "phone" } = {}) {
  const owner = await prisma.engineer.findFirst({ where: { id, ...live }, select: { id: true, email: true, phone: true } });
  if (!owner) throw notFound("There's no engineer with that ID.");
  let person: { email: string; phone: string | null } = owner;
  if (opts.staffId) {
    const staff = await prisma.engineer.findFirst({ where: { id: opts.staffId, ownerId: id, ...live }, select: { email: true, phone: true } });
    if (!staff) throw notFound("That person isn't on this engineer's team.");
    person = staff;
  }
  await adminEvent(admin, "admin_contact_revealed", {
    subjectType: "engineer",
    subjectId: id,
    engineerId: id,
    ...(opts.staffId ? { staffId: opts.staffId } : {}),
    ...(opts.field ? { field: opts.field } : {}),
  });
  if (opts.field === "email") return { email: person.email };
  if (opts.field === "phone") return { phone: person.phone };
  return { email: person.email, phone: person.phone };
}

// --- Standing ---------------------------------------------------------------

async function change(
  admin: AdminPrincipal,
  id: string,
  when: Prisma.EngineerWhereInput,
  data: Prisma.EngineerUpdateManyMutationInput,
  event: string,
  meta: Record<string, unknown>,
  alreadyMessage: string,
) {
  // The change and its record together, or neither; the record keeps what
  // the standing was before.
  await prisma.$transaction(async (tx) => {
    const before = await tx.engineer.findFirst({ where: { id, ...live }, select: STANDING });
    if (!before) throw notFound("There's no engineer with that ID.");
    const { count } = await tx.engineer.updateMany({ where: { id, ...live, ...when }, data });
    if (!count) throw conflict(alreadyMessage);
    await adminEvent(admin, event, { engineerId: id, ...meta, before }, tx);
  });
  return getEngineer(id);
}

const STANDING = {
  pausedAt: true,
  pauseReason: true,
  bannedAt: true,
  banReason: true,
  widgetDisabledAt: true,
} satisfies Prisma.EngineerSelect;

export const pauseEngineer = (admin: AdminPrincipal, id: string, reason: string) =>
  change(admin, id, { pausedAt: null, bannedAt: null }, { pausedAt: new Date(), pauseReason: reason }, "engineer_paused", { reason }, "This engineer is already paused or banned.");

export const resumeEngineer = (admin: AdminPrincipal, id: string, reason: string | null) =>
  change(admin, id, { pausedAt: { not: null } }, { pausedAt: null, pauseReason: null }, "engineer_resumed", { reason }, "This engineer isn't paused.");

export const banEngineer = (admin: AdminPrincipal, id: string, reason: string) =>
  change(admin, id, { bannedAt: null }, { bannedAt: new Date(), banReason: reason }, "engineer_banned", { reason }, "This engineer is already banned.");

export const unbanEngineer = (admin: AdminPrincipal, id: string, reason: string) =>
  change(admin, id, { bannedAt: { not: null } }, { bannedAt: null, banReason: null }, "engineer_unbanned", { reason }, "This engineer isn't banned.");

export const setWidget = (admin: AdminPrincipal, id: string, disabled: boolean, reason: string | null) =>
  change(
    admin,
    id,
    disabled ? { widgetDisabledAt: null } : { widgetDisabledAt: { not: null } },
    { widgetDisabledAt: disabled ? new Date() : null },
    disabled ? "website_widget_disabled" : "website_widget_enabled",
    { reason },
    disabled ? "The website widget is already switched off." : "The website widget is already on.",
  );
