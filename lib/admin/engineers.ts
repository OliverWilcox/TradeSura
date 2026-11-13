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
import { checksOf, dateOnly, gasSafeNumbers, nextRegisterCheck, personName, qualificationsOf, verificationStatus } from "@/lib/admin/verifications";
import { stripeLive, stripeStages } from "@/lib/admin/stripe-account";
import { ensureReferralCode, referralLink } from "@/lib/referral-code";
import { REFERRAL_FIRST_YEAR_MONTHS, referralRatePercent } from "@/lib/referral";
import { exactContactSearch, maskEmail, maskPhone } from "@/lib/admin/mask";
import {
  ACTIVE_WINDOW_DAYS,
  FUNNEL_STEPS,
  STEP_LABELS,
  activeEngineerIds,
  cancelRateOf,
  cancelRates,
  customerStatus,
  daysBetween,
  ladderStep,
  lastDeliveredOffers,
  milestones,
  offers,
  payments,
  testMarks,
  type FunnelStep,
  type Milestones,
  type TestMarks,
} from "@/lib/admin/metrics";
import { FOUNDING_RULES, foundingFor, foundingLabel, type FoundingStatus } from "@/lib/admin/founding";
import { formatAddress, postcodeOf, sameAddress, saveAddresses, tradingAddressOf, type PostalAddress } from "@/lib/addresses";

/** No test marks: statuses for every row a record shows (test rows are labelled, not hidden). */
const EVERYONE: TestMarks = { engineers: [], customers: [] };
import { testMarkOf } from "@/lib/admin/test-data";
import { currentPlan, customerSource } from "@/lib/admin/customers";
import { reasonList } from "@/lib/visit-reasons";
import { priceReviewCapPercent } from "@/lib/price-review";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { emailConfigured, sendEmail } from "@/lib/email";
import { noticeEmail } from "@/lib/admin/notice-email";

/** The yearly price-rise cap when PRICE_REVIEW_CAP_PERCENT isn't set (Matt: 10% a year). */
export const PRICE_RISE_CAP_PERCENT = 10;
/** Included benefits (the annual service and the rest) start with this monthly payment (Plan.paymentsCleared). */
export const BENEFITS_FROM_PAYMENT = 3;
import { companyProfile } from "@/lib/admin/companies";

// Engineers for the admin API: find them, see one in full, and change their
// standing. Pause and ban are the fields the app already enforces everywhere
// (offers, texts, town pages, enquiries — Build Guide v2 Part 6.4), so setting
// them here takes effect on the engineer's next request. Contact details are
// masked unless revealed, and every reveal is recorded.

/** The account's standing: what pause and ban change. */
export type EngineerStanding = "active" | "paused" | "banned" | "left";

/**
 * What the admin shows as an engineer's status: banned, left or paused when
 * the standing says so, otherwise active or inactive by the metrics layer's
 * definition (a delivered offer in the last ACTIVE_WINDOW_DAYS), so a list
 * and the dashboard's Active engineers agree.
 */
export type EngineerStatus = Exclude<EngineerStanding, "active"> | "active" | "inactive";

const live = { deletedAt: null } satisfies Prisma.EngineerWhereInput;

export const STATUS_WHERE: Record<EngineerStanding, Prisma.EngineerWhereInput> = {
  active: { bannedAt: null, pausedAt: null, leftAt: null },
  paused: { bannedAt: null, pausedAt: { not: null } },
  banned: { bannedAt: { not: null } },
  left: { leftAt: { not: null } },
};

/** The list's Gas Safe filter, by the card check and the register check (Matt, 4 Nov). */
const VERIFICATION_WHERE = {
  live: { gasSafeVerifiedAt: { not: null } },
  register_due: { gasSafeVerifiedAt: { not: null }, gasSafeRegisterCheckedAt: null },
  card_waiting: { gasSafeNo: { not: null }, gasSafeCardUrl: { not: null }, gasSafeVerifiedAt: null, gasSafeRejectedAt: null },
  no_card: { gasSafeNo: { not: null }, gasSafeCardUrl: null, gasSafeVerifiedAt: null, gasSafeRejectedAt: null },
  card_failed: { gasSafeVerifiedAt: null, gasSafeRejectedAt: { not: null }, gasSafeSuspendedAt: null },
  suspended: { gasSafeVerifiedAt: null, gasSafeSuspendedAt: { not: null } },
  not_submitted: { gasSafeNo: null, gasSafeVerifiedAt: null },
} satisfies Record<string, Prisma.EngineerWhereInput>;

export type VerificationFilter = keyof typeof VERIFICATION_WHERE;

export function engineerStatus(e: { bannedAt: Date | null; pausedAt: Date | null; leftAt: Date | null }): EngineerStanding {
  if (e.bannedAt) return "banned";
  if (e.leftAt) return "left";
  if (e.pausedAt) return "paused";
  return "active";
}

/** The status the admin shows, given who's active now (activeEngineerIds). */
export function displayStatus(e: { id: string; bannedAt: Date | null; pausedAt: Date | null; leftAt: Date | null }, active: Set<string>): EngineerStatus {
  const standing = engineerStatus(e);
  return standing !== "active" ? standing : active.has(e.id) ? "active" : "inactive";
}

/** The furthest step an engineer has reached, taking the steps in order (as the funnel does). */
export function furthestStep(m: Milestones): FunnelStep {
  let furthest: FunnelStep = FUNNEL_STEPS[0];
  for (const step of FUNNEL_STEPS) {
    if (!m[step].reached) break;
    furthest = step;
  }
  return furthest;
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
  gasSafeCardUrl: true,
  gasSafeCardExpiresOn: true,
  gasSafeVerifiedAt: true,
  gasSafeRejectedAt: true,
  gasSafeRegisterCheckedAt: true,
  gasSafeSuspendedAt: true,
  gasSafeRecheckRequestedAt: true,
  stripeAccountId: true,
  stripeDetailsSubmitted: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeOnboardingStartedAt: true,
  // Staff sit under their business: the list names the owner's (Matt, 4 Nov).
  owner: { select: { tradingName: true, legalName: true, slug: true } },
  createdAt: true,
  _count: {
    select: {
      customers: true,
      plans: { where: { status: "ACTIVE" } },
      tiers: { where: { status: "LIVE" } },
    },
  },
} satisfies Prisma.EngineerSelect;

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
  step?: FunnelStep;
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

/**
 * The list's filters. Active, inactive and the furthest step reached come
 * from the metrics layer, worked out for the engineers the other filters
 * match, so they can't drift from the dashboard.
 */
async function listWhere(q: EngineerListQuery, marks: TestMarks, active: Set<string>): Promise<Prisma.EngineerWhereInput> {
  const and: Prisma.EngineerWhereInput[] = [live];
  if (q.status === "active" || q.status === "inactive") {
    and.push(STATUS_WHERE.active, q.status === "active" ? { id: { in: [...active] } } : { id: { notIn: [...active] } });
  } else if (q.status) and.push(STATUS_WHERE[q.status]);
  if (q.verification) and.push(VERIFICATION_WHERE[q.verification]);
  if (q.type) and.push({ businessType: q.type });
  if (q.town) and.push({ town: { equals: q.town, mode: "insensitive" } });
  if (q.channel) and.push({ attribution: { path: ["heardVia"], equals: q.channel } });
  if (q.staff) and.push(q.staff === "staff" ? { ownerId: { not: null } } : { ownerId: null });
  if (q.joinedFrom || q.joinedTo) and.push({ createdAt: { ...(q.joinedFrom ? { gte: q.joinedFrom } : {}), ...(q.joinedTo ? { lt: q.joinedTo } : {}) } });
  if (q.q) and.push(engineerSearch(q.q));
  if (q.step) {
    const ids = (await prisma.engineer.findMany({ where: { AND: and }, select: { id: true } })).map((r) => r.id);
    const steps = await milestones(marks, { ids });
    and.push({ id: { in: ids.filter((id) => steps.has(id) && furthestStep(steps.get(id)!) === q.step) } });
  }
  return { AND: and };
}

/** What every list answer needs: who's test data, and who's active now. */
async function listContext() {
  const marks = await testMarks();
  return { marks, active: await activeEngineerIds(marks, new Date()) };
}

/** What a search box matches: names, business, town, postcode, Gas Safe and company numbers, or a whole email or phone number. */
export function engineerSearch(term: string): Prisma.EngineerWhereInput {
  const contains = { contains: likeTerm(term), mode: "insensitive" as const };
  const digits = term.replace(/\D/g, "");
  const contact = exactContactSearch(term);
  return {
    OR: [
      { firstName: contains },
      { lastName: contains },
      { tradingName: contains },
      { legalName: contains },
      { slug: contains },
      { town: contains },
      { postcode: contains },
      ...(digits.length >= 3 ? [{ gasSafeNo: { contains: digits } }, { gasSafeRegistrationNo: { contains: digits } }, { companyNumber: { contains: digits } }] : []),
      ...(contact.email ? [{ email: { equals: contact.email, mode: "insensitive" as const } }] : []),
      ...(contact.phone ? [{ phone: contact.phone }] : []),
    ],
  };
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
  const ctx = await listContext();
  const where = await listWhere(q, ctx.marks, ctx.active);
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
  return { items: await listItems(rows, ctx), page: q.page, size: q.size, total };
}

type ListRow = Prisma.EngineerGetPayload<{ select: typeof LIST_SELECT }>;

/** The follow-up ladder step: days since the last delivered offer, or since going live; null for staff, or anyone not live and in good standing. */
function followUpOf(e: { gasSafeVerifiedAt: Date | null; ownerId: string | null; bannedAt: Date | null; pausedAt: Date | null; leftAt: Date | null }, lastOfferAt: Date | null, now: Date) {
  const from = lastOfferAt ?? e.gasSafeVerifiedAt;
  if (!from || !e.gasSafeVerifiedAt || e.ownerId || engineerStatus(e) !== "active") return null;
  const days = daysBetween(from, now);
  return { lastDeliveredOfferAt: lastOfferAt?.toISOString() ?? null, countingFrom: lastOfferAt ? ("last_offer" as const) : ("live" as const), days, step: ladderStep(days) };
}

/** Each engineer's letter: the claim code they redeemed and its batch, or the batch their link carried. */
async function lettersOf(rows: { id: string; attribution: unknown }[]) {
  const claims = rows.length
    ? await prisma.claimCode.findMany({ where: { redeemedByEngineerId: { in: rows.map((r) => r.id) } }, select: { redeemedByEngineerId: true, code: true, letterBatch: true } })
    : [];
  const byEngineer = new Map(claims.map((c) => [c.redeemedByEngineerId!, c]));
  return new Map(
    rows.map((r) => {
      const claim = byEngineer.get(r.id);
      const batch = (r.attribution as { letterBatch?: string } | null)?.letterBatch ?? null;
      return [r.id, claim ? { code: claim.code, batch: claim.letterBatch } : batch ? { code: null, batch } : null];
    }),
  );
}

/** List rows as the API shows them, with each one's latest offer and customers on a plan. */
async function listItems(rows: ListRow[], ctx: { marks: TestMarks; active: Set<string> }) {
  const ids = rows.map((r) => r.id);
  const now = new Date();
  const [lastOffers, onPlans, founding, delivered, rates, letters] = await Promise.all([
    rows.length ? prisma.plan.groupBy({ by: ["engineerId"], where: { engineerId: { in: ids } }, _max: { createdAt: true } }) : [],
    customersOnPlans(ids),
    foundingFor(ids, now),
    lastDeliveredOffers(ctx.marks, ids),
    cancelRates(ctx.marks, ids, now),
    lettersOf(rows),
  ]);
  const lastOfferBy = new Map(lastOffers.map((l) => [l.engineerId, l._max.createdAt]));
  return rows.map((r) => ({
    id: r.id,
    name: personName(r),
    business: displayName(r.owner ?? r),
    slug: r.slug,
    town: r.town,
    type: r.businessType,
    channel: channelOf(r.attribution),
    isStaff: Boolean(r.ownerId),
    isTest: ctx.marks.engineers.includes(r.id),
    status: displayStatus(r, ctx.active),
    verification: verificationStatus(r),
    checks: (({ card, register }) => ({ card, register }))(checksOf(r, now)),
    nextRecheck: dateOnly(nextRegisterCheck(r.gasSafeRegisterCheckedAt, r.gasSafeCardExpiresOn)),
    founding: foundingSummary(founding.get(r.id)),
    followUp: followUpOf(r, delivered.get(r.id) ?? null, now)?.step?.label ?? null,
    cancelRate: (({ percent, flagged }) => ({ percent, flagged }))(rates.get(r.id)!),
    letter: letters.get(r.id) ?? null,
    stripe: stripeStages(r),
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
  const ctx = await listContext();
  const where = await listWhere({ ...q, page: 1, size: batch }, ctx.marks, ctx.active);
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
    yield await listItems(rows, ctx);
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
      owner: { select: { id: true, tradingName: true, legalName: true, slug: true, gasSafeNo: true, gasSafeRegistrationNo: true } },
      staff: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, staffRemovedAt: true, createdAt: true }, orderBy: { createdAt: "asc" } },
      referrer: { select: { id: true, tradingName: true, legalName: true, slug: true } },
      _count: { select: { customers: true, referrals: true, enquiries: true, stickers: true } },
    },
  });
  if (!e) return null;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000);
  const marks = await testMarks();
  const [planCounts, tiersLive, mrr, earnings, ratings, tiers, recentCustomers, payouts, invitees, steps, recentOffersSent, onPlans, test, company, cancelReasons] = await Promise.all([
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
      include: {
        properties: { select: { postcode: true, _count: { select: { appliances: true } }, passport: { select: { _count: { select: { appliances: true } } } } }, take: 1 },
        plans: {
          select: {
            id: true,
            status: true,
            activatedAt: true,
            createdAt: true,
            mandateStatus: true,
            priceMonthlyPence: true,
            linkOpenedAt: true,
            paymentFailedAt: true,
            paymentRecoveredAt: true,
            visitReason: true,
            tier: { select: { name: true, priceMonthlyPence: true } },
          },
        },
      },
    }),
    engineerPayouts(e.stripeAccountId),
    prisma.engineer.findMany({
      where: { referrerId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, tradingName: true, legalName: true, slug: true, createdAt: true, bannedAt: true, pausedAt: true, leftAt: true, _count: { select: { plans: { where: { activatedAt: { not: null } } } } } },
    }),
    milestones(marks, { ids: [id] }),
    offers(marks, { engineerIds: [id], from: weekAgo, to: now }),
    customersOnPlans([id]),
    testMarkOf("engineer", id),
    e.companyNumber ? companyProfile(e.companyNumber) : Promise.resolve(null),
    cancelReasonCounts(id),
  ]);
  const recentPlanIds = recentCustomers.flatMap((c) => c.plans.map((p) => p.id));
  const [tradingRow, claim, founding, lastOffer, cancelRate] = await Promise.all([
    prisma.engineerTradingAddress.findUnique({ where: { engineerId: id } }),
    prisma.claimCode.findUnique({ where: { redeemedByEngineerId: id }, select: { code: true, letterBatch: true, variantCell: true, redeemedAt: true } }),
    foundingFor([id], now),
    lastDeliveredOffers(marks, [id]),
    cancelRateOf(marks, id, now),
  ]);
  const [active, recentOffers, recentPaid, reasons, tierEvents, rises] = await Promise.all([
    activeEngineerIds(marks, new Date(), [id, ...invitees.map((i) => i.id)]),
    recentPlanIds.length ? offers(EVERYONE, { planIds: recentPlanIds }) : [],
    recentPlanIds.length ? payments(EVERYONE, { planIds: recentPlanIds }) : [],
    reasonList().then((list) => new Map(list.map((r) => [r.reason, r.label]))),
    // When each plan was published and edited: its version is one more than its edits.
    tiers.length
      ? prisma.event.findMany({
          where: { name: { in: ["plan_live", "plan_edited", "plan_taken_down"] }, OR: tiers.map((t) => ({ meta: { path: ["tierId"], equals: t.id } })) },
          orderBy: { ts: "asc" },
          select: { name: true, ts: true, meta: true },
        })
      : [],
    // Price rises on customers' plans, by the plan they're on.
    prisma.priceReview.findMany({ where: { plan: { engineerId: id } }, orderBy: { noticeSentAt: "desc" }, select: { oldPence: true, newPence: true, noticeSentAt: true, effectiveAt: true, appliedAt: true, voidedAt: true, plan: { select: { tierId: true } } } }),
  ]);
  const cap = priceReviewCapPercent() ?? PRICE_RISE_CAP_PERCENT;
  const offerByPlan = new Map(recentOffers.map((o) => [o.planId, o]));
  const paidPlans = new Set(recentPaid.map((p) => p.planId));
  const reached = steps.get(id)!;
  const [byInvitee, paidByInvitee, paidOut, referralCode, stripe] = await Promise.all([
    invitees.length
      ? prisma.referralEarning.groupBy({ by: ["inviteeId"], where: { referrerId: id, inviteeId: { in: invitees.map((i) => i.id) } }, _sum: { amountPence: true } })
      : [],
    invitees.length
      ? prisma.referralEarning.groupBy({ by: ["inviteeId"], where: { referrerId: id, inviteeId: { in: invitees.map((i) => i.id) }, transferId: { not: null } }, _sum: { amountPence: true } })
      : [],
    prisma.referralEarning.aggregate({ where: { referrerId: id, transferId: { not: null } }, _sum: { amountPence: true } }),
    ensureReferralCode(id),
    stripeLive(e.stripeAccountId),
  ]);
  const earnedBy = new Map(byInvitee.map((r) => [r.inviteeId, r._sum.amountPence ?? 0]));
  const paidBy = new Map(paidByInvitee.map((r) => [r.inviteeId, r._sum.amountPence ?? 0]));
  const plans = { ACTIVE: 0, PENDING: 0, PAUSED: 0, CANCELLED: 0 };
  for (const p of planCounts) plans[p.status] = p._count._all;
  const monthly = mrr._sum.priceMonthlyPence ?? 0;
  const attribution = (e.attribution ?? {}) as { heardVia?: string; referralCode?: string; letterBatch?: string; variantCell?: string };
  const trading = tradingAddressOf(tradingRow, e.packAddress);
  const office = company?.registeredOffice ?? null;
  const checks = checksOf(e, now);
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
    /**
     * Each address on its own: the areas the engineer says they cover, the
     * postcode given at sign-up, the postal address packs go to, and the
     * registered office Companies House holds (limited companies).
     */
    addresses: {
      areasCovered: (e.serviceArea ?? "").split(",").map((a) => a.trim()).filter(Boolean),
      signupPostcode: e.postcode,
      postal: e.packAddress,
      registeredOffice: office,
      /** Sets the town and town page. Null source: read from the pack address, not saved yet. */
      trading: trading && {
        lines: trading.lines,
        town: trading.town,
        postcode: trading.postcode,
        source: trading.source,
        updatedAt: trading.updatedAt?.toISOString() ?? null,
        updatedBy: trading.updatedByName,
      },
      /** Where the member pack and all post go (the pack address). */
      correspondence: { address: e.packAddress, sameAsTrading: !e.packAddress || (trading ? sameAddress(e.packAddress, formatAddress(trading)) : false) },
      /** The trading address is at Companies House's registered office: usually not where they work. */
      tradingIsRegisteredOffice: Boolean(office && trading && postcodeOf(office) === postcodeOf(trading.postcode)),
    },
    company: company ? { name: company.name, type: company.type, status: company.status } : null,
    contact: {
      email: maskEmail(e.email),
      phone: e.phone ? maskPhone(e.phone) : null,
      revealed: false,
      phoneVerifiedAt: e.phoneVerifiedAt?.toISOString() ?? null,
      /** "TradeSura can text me to help me finish setting up": when they agreed. */
      setupTextConsentAt: e.setupTextConsentAt?.toISOString() ?? null,
      /** "Send me tips and product updates", asked at sign-up. */
      marketingConsent: e.marketingConsent,
    },
    joinedAt: e.createdAt.toISOString(),
    channel: attribution.heardVia ?? null,
    letterBatch: attribution.letterBatch ?? null,
    /** The referral code they typed at sign-up, if any (who referred them is referrals.referredBy). */
    referralCodeGiven: attribution.referralCode ?? null,
    /** The letter they came from: the claim code they redeemed, or the batch their link carried. */
    letter: claim
      ? { code: claim.code, batch: claim.letterBatch, variant: claim.variantCell, redeemedAt: claim.redeemedAt?.toISOString() ?? null }
      : attribution.letterBatch
        ? { code: null, batch: attribution.letterBatch, variant: attribution.variantCell ?? null, redeemedAt: null }
        : null,
    status: displayStatus(e, active),
    standing: standingState(e),
    test,
    pause: e.pausedAt ? { at: e.pausedAt.toISOString(), reason: e.pauseReason } : null,
    ban: e.bannedAt ? { at: e.bannedAt.toISOString(), reason: e.banReason } : null,
    leftAt: e.leftAt?.toISOString() ?? null,
    verification: {
      status: verificationStatus(e),
      /** The card check (passed = live) and the register check behind it (Matt, 4 Nov). */
      card: checks.card,
      register: checks.register,
      liveSince: e.gasSafeVerifiedAt?.toISOString() ?? null,
      registerCheckedAt: e.gasSafeRegisterCheckedAt?.toISOString() ?? null,
      suspendedAt: e.gasSafeSuspendedAt?.toISOString() ?? null,
      recheckRequested: e.gasSafeRecheckRequestedAt ? { at: e.gasSafeRecheckRequestedAt.toISOString(), reason: e.gasSafeRecheckReason } : null,
      rejectedAt: e.gasSafeRejectedAt?.toISOString() ?? null,
      rejectReason: e.gasSafeRejectReason,
    },
    /** The Gas Safe ID card: the engineer's licence number and the business's registration number, each on its own. */
    gasSafe: {
      licenceNo: gasSafeNumbers(e).licenceNo,
      registrationNo: gasSafeNumbers(e).registrationNo ?? (e.owner ? gasSafeNumbers(e.owner).registrationNo : null),
      categories: e.gasSafeCategories,
      cardOnFile: Boolean(e.gasSafeCardUrl),
      cardExpiresOn: dateOnly(e.gasSafeCardExpiresOn),
      qualifications: qualificationsOf(e.qualificationConfirmations),
      nextRegisterCheck: dateOnly(nextRegisterCheck(e.gasSafeRegisterCheckedAt, e.gasSafeCardExpiresOn)),
    },
    founding: foundingDto(founding.get(id)!),
    /** Days since their last delivered offer and the follow-up ladder step; null unless live and in good standing. */
    chase: followUpOf(e, lastOffer.get(id) ?? null, now),
    cancelRate,
    payments: {
      accountId: e.stripeAccountId,
      connected: Boolean(e.stripeAccountId),
      detailsSubmitted: e.stripeDetailsSubmitted,
      chargesEnabled: e.stripeChargesEnabled,
      payoutsEnabled: e.stripePayoutsEnabled,
      needsInfo: Boolean(e.stripeAccountId && e.stripeDetailsSubmitted && !e.stripeChargesEnabled),
      ...stripeStages(e),
      /** Asked of Stripe live; null when it couldn't be. */
      live: stripe,
    },
    activation: {
      paymentsReady: e.stripeChargesEnabled,
      planLive: tiersLive > 0,
      firstCustomer: plans.ACTIVE + plans.PAUSED + plans.CANCELLED > 0,
      profilePublished: Boolean(e.profilePublishedAt),
      websiteConnected: Boolean(e.websiteConnectedAt),
    },
    counts: { customers: e._count.customers, customersOnPlans: onPlans.get(id) ?? 0, plans, tiersLive, enquiries: e._count.enquiries, stickers: e._count.stickers },
    cancelReasons,
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
      code: referralCode,
      link: referralLink(referralCode),
      referredBy: e.referrer ? { id: e.referrer.id, business: displayName(e.referrer) } : null,
      invited: e._count.referrals,
      earnedPence: earnings._sum.amountPence ?? 0,
      paidPence: paidOut._sum.amountPence ?? 0,
      owedPence: Math.max(0, (earnings._sum.amountPence ?? 0) - (paidOut._sum.amountPence ?? 0)),
      /** Per referred engineer: plans they've sold, the rate now (25% for 12 months, then 10%) and the months left at 25%. */
      people: invitees.map((i) => {
        const firstYearEnds = new Date(i.createdAt);
        firstYearEnds.setMonth(firstYearEnds.getMonth() + REFERRAL_FIRST_YEAR_MONTHS);
        const earned = earnedBy.get(i.id) ?? 0;
        return {
          id: i.id,
          business: displayName(i),
          joinedAt: i.createdAt.toISOString(),
          status: displayStatus(i, active),
          plansSold: i._count.plans,
          ratePercent: referralRatePercent(i.createdAt, now),
          monthsLeftAtFirstRate: Math.max(0, Math.ceil((firstYearEnds.getTime() - now.getTime()) / (30.44 * 86_400_000))),
          earnedPence: earned,
          owedPence: Math.max(0, earned - (paidBy.get(i.id) ?? 0)),
        };
      }),
    },
    tiers: tiers.map((t) => {
      const mine = tierEvents.filter((ev) => (ev.meta as { tierId?: string } | null)?.tierId === t.id);
      const edits = mine.filter((ev) => ev.name === "plan_edited");
      const takenDown = [...mine].reverse().find((ev) => ev.name === "plan_taken_down");
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        priceMonthlyPence: t.priceMonthlyPence,
        options: t.clauses.map((c) => c.clause).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.title),
        customersOnIt: t._count.plans,
        publishedAt: mine.find((ev) => ev.name === "plan_live")?.ts.toISOString() ?? null,
        editedAt: edits.at(-1)?.ts.toISOString() ?? null,
        /** Customers keep the version they signed; an edit only reaches new customers. */
        version: edits.length + 1,
        takenDown: takenDown ? { at: takenDown.ts.toISOString(), reason: (takenDown.meta as { reason?: string }).reason ?? null, by: (takenDown.meta as { adminName?: string }).adminName ?? null } : null,
        /** Price rises on customers' plans, against the yearly cap. */
        priceRises: rises
          .filter((r) => r.plan.tierId === t.id)
          .map((r) => {
            const percent = Math.round(((r.newPence - r.oldPence) / r.oldPence) * 1000) / 10;
            return { fromPence: r.oldPence, toPence: r.newPence, percent, overCap: percent > cap, noticeSentAt: r.noticeSentAt.toISOString(), effectiveAt: r.effectiveAt.toISOString(), applied: !!r.appliedAt, voided: !!r.voidedAt };
          }),
      };
    }),
    /** The plan rules the record states: the yearly price-rise cap, and when included benefits start (lib/plan-rules). */
    planRules: { priceRiseCapPercent: cap, benefitsFromPayment: BENEFITS_FROM_PAYMENT },
    recentCustomers: recentCustomers.map((c) => {
      const plan = currentPlan(c.plans);
      const offered = c.plans.some((p) => offerByPlan.has(p.id));
      return {
        id: c.id,
        name: `${c.firstName} ${c.lastName}`.trim(),
        postcode: c.properties[0]?.postcode ?? null,
        plan: plan ? { name: plan.tier?.name ?? null, priceMonthlyPence: plan.priceMonthlyPence ?? plan.tier?.priceMonthlyPence ?? null } : null,
        source: customerSource(c.source, offered),
        visitReason: plan?.visitReason ? (reasons.get(plan.visitReason) ?? plan.visitReason) : null,
        firstPaymentAt: c.plans.flatMap((p) => recentPaid.filter((x) => x.planId === p.id).map((x) => x.paidAt)).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null,
        boilerRegistered: c.properties.some((p) => p._count.appliances > 0 || (p.passport?._count.appliances ?? 0) > 0),
        planStatus: plan?.status ?? null,
        status: customerStatus(plan ?? null, { offer: plan ? (offerByPlan.get(plan.id) ?? null) : null, paid: plan ? paidPlans.has(plan.id) : false }),
        since: (plan?.activatedAt ?? c.createdAt).toISOString(),
      };
    }),
    payouts: payouts.recent,
    lifetimePayoutsPence: payouts.totalPence,
    /** The activation steps, in the funnel's order, from the same source as the funnel. */
    steps: FUNNEL_STEPS.map((step) => ({ key: step, label: STEP_LABELS[step], reached: reached[step].reached, at: reached[step].at?.toISOString() ?? null })),
    /** Delivered offers in the last ACTIVE_WINDOW_DAYS: what makes them active. */
    offersLast7Days: recentOffersSent.filter((o) => o.delivery === "delivered").length,
    ratings: { count: ratings._count._all, average: ratings._avg.stars === null ? null : Math.round(ratings._avg.stars * 10) / 10 },
    memberPack: { requestedAt: e.packRequestedAt?.toISOString() ?? null, shippedAt: e.packShippedAt?.toISOString() ?? null },
    website: { connectedAt: e.websiteConnectedAt?.toISOString() ?? null, host: e.websiteHost, widgetDisabledAt: e.widgetDisabledAt?.toISOString() ?? null },
    profile: { publishedAt: e.profilePublishedAt?.toISOString() ?? null, url: `${appUrl()}/${e.slug}` },
  };
}

export type EngineerDetail = NonNullable<Awaited<ReturnType<typeof getEngineer>>>;

/** A Founding status as the API sends it, with the rules the app works it out by. */
function foundingDto(f: FoundingStatus) {
  const spot = f.spot;
  return {
    rules: FOUNDING_RULES,
    member: f.member,
    label: foundingLabel(f),
    town: f.town,
    spot: !spot
      ? null
      : spot.state === "holding"
        ? { state: spot.state, position: spot.position, heldFrom: spot.heldFrom.toISOString(), endsAt: spot.endsAt.toISOString(), daysLeft: spot.daysLeft, kept: spot.kept, remindersSent: spot.remindersSent }
        : { state: spot.state, heldFrom: spot.heldFrom.toISOString(), releasedAt: spot.releasedAt.toISOString(), reason: spot.reason },
  };
}

/** The list's Founding column: badge, top spot (with days left of 60) or released, worded as the record words it. */
function foundingSummary(f: FoundingStatus | undefined) {
  if (!f) return null;
  if (f.spot?.state === "holding") return { label: foundingLabel(f), daysLeft: f.spot.kept ? null : f.spot.daysLeft };
  // The badge is permanent: a released spot doesn't take it away.
  if (f.spot?.state === "released") return { label: f.member ? "Founding · spot released" : "Spot released", daysLeft: null };
  return f.member ? { label: foundingLabel(f), daysLeft: null } : null;
}

/**
 * An admin changes the trading address and where post goes (engineer record
 * 1), for an engineer whose sign-up gave the registered office (302 MD LTD)
 * or who's told TradeSura of a move. Town, town page and pack address follow
 * (lib/addresses.ts); the change is recorded with the town before and after.
 */
export async function saveEngineerAddresses(admin: AdminPrincipal, id: string, input: { trading: PostalAddress; correspondence: PostalAddress | "same" }, reason: string | null) {
  const e = await prisma.engineer.findFirst({ where: { id, ...live }, select: { ownerId: true } });
  if (!e) throw notFound("There's no engineer with that ID.");
  if (e.ownerId) throw conflict("Staff work from the business's addresses: change the owner's instead.");
  return prisma.$transaction(async (tx) => {
    const saved = await saveAddresses(tx, id, input, { source: "admin", id: admin.id, name: admin.name });
    await adminEvent(
      admin,
      "engineer_addresses_changed",
      { engineerId: id, townBefore: saved.townBefore, town: saved.town, postChanged: saved.packAddressChanged, sameAsTrading: saved.correspondenceSameAsTrading, reason },
      tx,
    );
    return { town: saved.town, townBefore: saved.townBefore, correspondenceSameAsTrading: saved.correspondenceSameAsTrading };
  });
}

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

/** Why their customers cancelled: each cancelled plan's latest reason, counted. */
async function cancelReasonCounts(engineerId: string) {
  const cancelled = await prisma.plan.findMany({
    where: { engineerId, status: "CANCELLED" },
    select: { cancellations: { orderBy: { createdAt: "desc" }, take: 1, select: { reason: true } } },
  });
  const counts = new Map<string, number>();
  for (const p of cancelled) {
    const reason = p.cancellations[0]?.reason ?? "none";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** How far back the activity tab reads: the newest events and texts, merged. */
const ACTIVITY_WINDOW = 300;

/**
 * What happened to an engineer, newest first: their own actions, anything
 * done to them or their customers, and the texts TradeSura sent them
 * (Matt, 4 Nov). Each row names who did it ("Matt (admin)", "Matt Wood
 * (engineer)"), the customer and plan it was about, and for an edited plan
 * what it was before. A plan going live is "Plan published" when the
 * engineer put one on sale, "Customer joined" when a customer's started.
 */
export async function engineerActivity(id: string, q: { page: number; size: number }) {
  const e = await prisma.engineer.findFirst({ where: { id, ...live }, select: { firstName: true, lastName: true, phone: true, staff: { select: { id: true, firstName: true, lastName: true } } } });
  if (!e) throw notFound("There's no engineer with that ID.");
  const where: Prisma.EventWhereInput = { OR: [{ actorId: id }, { meta: { path: ["engineerId"], equals: id } }] };
  const textsWhere: Prisma.OutboundSmsWhereInput = e.phone ? { engineerId: id, toPhone: e.phone } : { id: "" };
  const [events, eventCount, texts, textCount] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { ts: "desc" }, take: ACTIVITY_WINDOW }),
    prisma.event.count({ where }),
    prisma.outboundSms.findMany({ where: textsWhere, orderBy: { sendAfter: "desc" }, take: ACTIVITY_WINDOW, select: { id: true, body: true, status: true, sendAfter: true, sentAt: true, deliveredAt: true, failedAt: true } }),
    prisma.outboundSms.count({ where: textsWhere }),
  ]);
  const meta = (ev: { meta: unknown }) => (ev.meta ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  // The customers, plans and plan names the events point at, looked up once.
  const planIds = [...new Set(events.map((ev) => str(meta(ev).planId)).filter((v): v is string => !!v))];
  const customerIds = [...new Set(events.map((ev) => str(meta(ev).customerId)).filter((v): v is string => !!v))];
  const tierIds = [...new Set(events.map((ev) => str(meta(ev).tierId)).filter((v): v is string => !!v))];
  const [plans, customers, tiers] = await Promise.all([
    planIds.length ? prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, customerId: true, tier: { select: { name: true } }, customer: { select: { firstName: true, lastName: true } } } }) : [],
    customerIds.length ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
    tierIds.length ? prisma.planTier.findMany({ where: { id: { in: tierIds } }, select: { id: true, name: true } }) : [],
  ]);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const customerName = new Map([...customers.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()] as const), ...plans.map((p) => [p.customerId, `${p.customer.firstName} ${p.customer.lastName}`.trim()] as const)]);
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));
  const people = new Map([[id, personName(e)], ...e.staff.map((st) => [st.id, personName(st)] as const)]);
  // An edited plan's "before" is the same plan's previous published or edited state.
  const chronological = [...events].reverse();
  const before = new Map<string, { name: string | null; priceMonthlyPence: number | null }>();
  const lastState = new Map<string, { name: string | null; priceMonthlyPence: number | null }>();
  for (const ev of chronological) {
    const tierId = str(meta(ev).tierId);
    if (!tierId || (ev.name !== "plan_live" && ev.name !== "plan_edited")) continue;
    if (ev.name === "plan_edited" && lastState.has(tierId)) before.set(ev.id, lastState.get(tierId)!);
    const m = meta(ev);
    lastState.set(tierId, { name: str(m.name), priceMonthlyPence: typeof m.priceMonthlyPence === "number" ? m.priceMonthlyPence : null });
  }
  const actorOf = (ev: { actorType: string; actorId: string | null; meta: unknown }) => {
    const admin = str(meta(ev).adminName);
    if (ev.actorType === "ADMIN") return { type: ev.actorType, id: ev.actorId, name: admin ? `${admin} (admin)` : "An admin" };
    if (ev.actorType === "ENGINEER" && ev.actorId && people.has(ev.actorId)) return { type: ev.actorType, id: ev.actorId, name: `${people.get(ev.actorId)} (engineer)` };
    if (ev.actorType === "CUSTOMER" && ev.actorId) return { type: ev.actorType, id: ev.actorId, name: customerName.get(ev.actorId) ? `${customerName.get(ev.actorId)} (customer)` : "The customer" };
    return { type: ev.actorType, id: ev.actorId, name: ev.actorType === "SYSTEM" ? "TradeSura" : null };
  };
  const eventItems = events.map((ev) => {
    const m = meta(ev);
    const plan = str(m.planId) ? planById.get(str(m.planId)!) : undefined;
    const tierId = str(m.tierId);
    const name = ev.name === "plan_live" ? (tierId ? "plan_published" : "customer_joined") : ev.name;
    const customerId = plan?.customerId ?? str(m.customerId);
    return {
      id: ev.id,
      name,
      at: ev.ts,
      actor: actorOf(ev),
      reason: str(m.reason),
      detail: {
        customer: customerId ? { id: customerId, name: customerName.get(customerId) ?? null } : null,
        plan: plan?.tier?.name ?? (tierId ? (str(m.name) ?? tierName.get(tierId) ?? null) : null),
        before: before.get(ev.id) ?? null,
        after: ev.name === "plan_edited" ? { name: str(m.name), priceMonthlyPence: typeof m.priceMonthlyPence === "number" ? m.priceMonthlyPence : null } : null,
        channel: str(m.channel),
      },
    };
  });
  const textItems = texts.map((t) => ({
    id: `sms:${t.id}`,
    name: "engineer_texted",
    at: t.sentAt ?? t.sendAfter,
    actor: { type: "SYSTEM", id: null, name: "TradeSura" },
    reason: null,
    detail: { customer: null, plan: null, before: null, after: null, channel: "sms", body: t.body, delivery: t.status === "CANCELLED" ? "not_sent" : t.failedAt ? "failed" : t.deliveredAt ? "delivered" : t.status === "SENT" ? "sent" : "due" },
  }));
  const all = [...eventItems, ...textItems].sort((a, b) => b.at.getTime() - a.at.getTime());
  const items = all.slice((q.page - 1) * q.size, q.page * q.size).map((i) => ({ ...i, at: i.at.toISOString() }));
  return { items, page: q.page, size: q.size, total: Math.min(eventCount, ACTIVITY_WINDOW) + Math.min(textCount, ACTIVITY_WINDOW) };
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

/**
 * Take a plan that breaks the rules off sale (Matt, 4 Nov): no new
 * customers; those already on it keep the plan they signed. The engineer is
 * told why, by text, push and email, and the reason is recorded.
 */
export async function takeDownTier(admin: AdminPrincipal, engineerId: string, tierId: string, reason: string) {
  const tier = await prisma.planTier.findFirst({ where: { id: tierId, engineerId, engineer: live }, select: { id: true, name: true, status: true } });
  if (!tier) throw notFound("There's no such plan on this engineer's account.");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.planTier.updateMany({ where: { id: tierId, status: "LIVE" }, data: { status: "STOPPED" } });
    if (!count) throw conflict("Only a plan that's on sale can be taken down.");
    await adminEvent(admin, "plan_taken_down", { engineerId, tierId, name: tier.name, reason }, tx);
  });
  const line = `TradeSura has taken your plan "${tier.name}" off sale: ${reason}. Customers already on it keep it. Open the app to fix it.`;
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { email: true, firstName: true } });
  const sends = [
    () => notifyEngineer(engineerId, `TradeSura: ${line}`),
    () => sendPushNotification(engineerId, "Plan taken off sale", line, { url: "/plans" }),
    async () => {
      if (!engineer?.email || !emailConfigured()) return;
      await sendEmail({
        to: engineer.email,
        ...noticeEmail({
          firstName: engineer.firstName,
          title: `Your plan "${tier.name}" is off sale`,
          paragraphs: [`TradeSura has taken your plan "${tier.name}" off sale: ${reason}.`, "Customers already on it keep it. Open the TradeSura app to fix the plan and put it back on sale."],
        }),
      });
    },
  ];
  for (const send of sends) {
    try {
      await send();
    } catch (err) {
      console.error("[admin-api] plan take-down notice failed:", err);
    }
  }
  return { id: tierId, status: "STOPPED" as const };
}
