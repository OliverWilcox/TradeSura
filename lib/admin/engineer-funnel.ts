import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { bounded, shared } from "@/lib/admin-api/db";
import { offers, testMarks, type Range } from "@/lib/admin/metrics";
import { ukDay, ukMidnight } from "@/lib/admin/time";
import { reasonList } from "@/lib/visit-reasons";

const DAY_MS = 24 * 60 * 60 * 1000;

export const ENGINEER_FUNNEL_STEPS = [
  { key: "letters_posted", label: "Letters posted" },
  { key: "claim_scans", label: "Claim page scans" },
  { key: "details_completed", label: "Details form completed" },
  { key: "store_opened", label: "Store opened" },
  { key: "store_downloads", label: "Store views › downloads", noData: "App Store Connect and Play Console" },
  { key: "signed_up", label: "Sign-ups with code" },
  { key: "card_uploaded", label: "Gas Safe card uploaded" },
  { key: "card_check_passed", label: "Card check passed (went live)" },
  { key: "plans_live_stage1", label: "Plans live + Stripe stage 1" },
  { key: "first_offer", label: "First offer delivered" },
  { key: "first_customer", label: "First customer" },
  { key: "stage2_done", label: "Stripe stage 2 done" },
  { key: "first_payout", label: "First payout" },
  { key: "register_check_passed", label: "Register check passed" },
] as const;

export type EngineerFunnelStep = (typeof ENGINEER_FUNNEL_STEPS)[number]["key"];

const FROM_LETTERS: EngineerFunnelStep = "signed_up";
const FROM_LETTERS_NOTE = "Counted from the letters posted: a code typed into the app skips the claim page.";
const BRANCHES: Partial<Record<EngineerFunnelStep, { from: EngineerFunnelStep; note: string }>> = {
  register_check_passed: { from: "card_check_passed", note: "Counted from the card check: the register check doesn't wait for plans, customers or payouts." },
};
type Reach = { reached: boolean; at: Date | null };
type Item = Record<EngineerFunnelStep, Reach>;

const no: Reach = { reached: false, at: null };
const yes = (at: Date | null): Reach => ({ reached: true, at });
const when = (at: Date | null | undefined): Reach => (at ? yes(at) : no);

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function reachedAt(item: Item, keys: readonly EngineerFunnelStep[]): (Date | null)[] {
  let latest: Date | null = null;
  let known = true;
  return keys.map((key) => {
    if (key === FROM_LETTERS) {
      known = Boolean(item.letters_posted.reached && item.letters_posted.at);
      latest = item.letters_posted.at;
    }
    const r = item[key];
    if (!known || !r.reached || !r.at) {
      known = false;
      return null;
    }
    if (!latest || r.at > latest) latest = r.at;
    return latest;
  });
}

export type FunnelStepOut = {
  key: EngineerFunnelStep;
  label: string;
  count: number | null;
  noData: string | null;
  ofStart: number | null;
  fromPrevious: number | null;
  medianDaysFromPrevious: number | null;
  medianOf: number;
  comparedWith: EngineerFunnelStep | null;
  note: string | null;
};

export const FUNNEL_CHANNELS = ["letter", "referral", "website", "job", "other", "all"] as const;
export type FunnelChannel = (typeof FUNNEL_CHANNELS)[number];
export type FunnelStart = "letters" | "signups";
const LETTERS_ONLY = "Only letters have this step";
const BEFORE_SIGNUP = new Set<EngineerFunnelStep>(ENGINEER_FUNNEL_STEPS.slice(0, ENGINEER_FUNNEL_STEPS.findIndex((s) => s.key === FROM_LETTERS)).map((s) => s.key));

export function engineerFunnelOf(items: Item[], start: FunnelStart = "letters"): FunnelStepOut[] {
  const counted = ENGINEER_FUNNEL_STEPS.filter((s) => !("noData" in s)).map((s) => s.key);
  const reached = new Map(items.map((it) => [it, reachedAt(it, counted)]));
  let still = items;
  let previousCounted = -1;
  const reachedBy = new Map<EngineerFunnelStep, Item[]>();
  return ENGINEER_FUNNEL_STEPS.map((step) => {
    if (start === "signups" && BEFORE_SIGNUP.has(step.key)) {
      return { key: step.key, label: step.label, count: null, noData: LETTERS_ONLY, ofStart: null, fromPrevious: null, medianDaysFromPrevious: null, medianOf: 0, comparedWith: null, note: null };
    }
    if (start === "signups" && step.key === FROM_LETTERS) {
      still = items;
      previousCounted = counted.indexOf(FROM_LETTERS);
      reachedBy.set(step.key, items);
      return { key: step.key, label: "Sign-ups", count: items.length, noData: null, ofStart: items.length ? 1 : 0, fromPrevious: null, medianDaysFromPrevious: null, medianOf: 0, comparedWith: null, note: null };
    }
    if ("noData" in step) {
      return { key: step.key, label: step.label, count: null, noData: step.noData, ofStart: null, fromPrevious: null, medianDaysFromPrevious: null, medianOf: 0, comparedWith: null, note: null };
    }
    const i = counted.indexOf(step.key);
    const branch = BRANCHES[step.key];
    if (branch) {
      const base = reachedBy.get(branch.from) ?? [];
      const got = base.filter((it) => it[step.key].reached);
      const gaps = got.flatMap((it) => {
        const [a, b] = [it[branch.from].at, it[step.key].at];
        return a && b ? [Math.max(0, b.getTime() - a.getTime()) / DAY_MS] : [];
      });
      reachedBy.set(step.key, got);
      return {
        key: step.key,
        label: step.label,
        count: got.length,
        noData: null,
        ofStart: items.length ? got.length / items.length : 0,
        fromPrevious: base.length ? got.length / base.length : 0,
        medianDaysFromPrevious: median(gaps),
        medianOf: gaps.length,
        comparedWith: branch.from,
        note: branch.note,
      };
    }
    if (step.key === FROM_LETTERS) {
      still = items;
      previousCounted = 0;
    }
    const before = still.length;
    still = still.filter((it) => it[step.key].reached);
    const gaps =
      previousCounted >= 0
        ? still.flatMap((it) => {
            const [a, b] = [reached.get(it)![previousCounted], reached.get(it)![i]];
            return a && b ? [(b.getTime() - a.getTime()) / DAY_MS] : [];
          })
        : [];
    const comparedWith = previousCounted >= 0 ? counted[previousCounted]! : null;
    previousCounted = i;
    reachedBy.set(step.key, still);
    return {
      key: step.key,
      label: step.label,
      count: still.length,
      noData: null,
      ofStart: items.length ? still.length / items.length : 0,
      fromPrevious: before ? still.length / before : 0,
      medianDaysFromPrevious: i === 0 ? null : median(gaps),
      medianOf: gaps.length,
      comparedWith,
      note: step.key === FROM_LETTERS ? FROM_LETTERS_NOTE : null,
    };
  });
}

type EngineerRow = {
  id: string;
  gasSafeCardUrl: string | null;
  gasSafeVerifiedAt: Date | null;
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripePayoutsEnabled: boolean;
  accountCompletedAt: Date | null;
  gasSafeRegisterCheckedAt: Date | null;
  tierLive: boolean;
  firstCustomerAt: Date | null;
  cardAddedAt: Date | null;
  firstPayoutAt: Date | null;
};

export type EngineerFunnelFilters = { batch?: string; code?: string; town?: string; reason?: string; channel?: FunnelChannel };

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export async function engineerFunnelOptions() {
  const [batches, towns, reasons, engineerTowns] = await Promise.all([
    prisma.claimCode.groupBy({ by: ["letterBatch"], _min: { createdAt: true } }),
    prisma.claimCode.findMany({ where: { town: { not: null } }, distinct: ["town"], select: { town: true }, orderBy: { town: "asc" } }),
    reasonList(),
    prisma.engineer.findMany({ where: { ownerId: null, deletedAt: null, town: { not: null } }, distinct: ["town"], select: { town: true }, orderBy: { town: "asc" } }),
  ]);
  const info = new Map((await prisma.letterBatch.findMany({ select: { name: true, area: true } })).map((b) => [b.name, b.area]));
  return {
    batches: batches
      .sort((a, b) => (b._min.createdAt?.getTime() ?? 0) - (a._min.createdAt?.getTime() ?? 0))
      .map((b) => ({ name: b.letterBatch, area: info.get(b.letterBatch) ?? null })),
    towns: towns.map((t) => t.town!).filter(Boolean),
    engineerTowns: engineerTowns.map((t) => t.town!.trim()).filter(Boolean).filter((t, i, all) => all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i),
    channels: FUNNEL_CHANNELS,
    reasons: reasons.map((r) => ({ reason: r.reason, label: r.label })),
  };
}

export function engineerFunnel(range: Range, filters: EngineerFunnelFilters = {}) {
  const key = [range.from.toISOString(), range.to.toISOString(), filters.batch ?? "", filters.code ?? "", filters.town ?? "", filters.reason ?? ""].join(":");
  return shared(`engineer-funnel:${key}`, async () => {
    const marks = await testMarks();
    const fromDay = ukDay(range.from);
    const toDay = ukDay(new Date(range.to.getTime() - 1));
    const batches = await prisma.letterBatch.findMany({ select: { name: true, postedOn: true } });
    const postedOn = new Map(batches.map((b) => [b.name, b.postedOn]));
    const postedInRange = batches.filter((b) => dayOf(b.postedOn) >= fromDay && dayOf(b.postedOn) <= toDay).map((b) => b.name);
    const codes = await prisma.claimCode.findMany({
      where: {
        suppressedAt: null,
        OR: [{ letterBatch: { in: postedInRange } }, { letterBatch: { notIn: [...postedOn.keys()] }, createdAt: { gte: range.from, lt: range.to } }],
        ...(filters.batch ? { letterBatch: filters.batch } : {}),
        ...(filters.code ? { code: filters.code.trim().toUpperCase() } : {}),
        ...(filters.town ? { town: { equals: filters.town, mode: "insensitive" as const } } : {}),
      },
      select: { code: true, createdAt: true, claimedAt: true, letterBatch: true, redeemedByEngineerId: true, redeemedAt: true },
    });
    if (!codes.length) return { start: "letters" as const, batches: 0, letters: 0, signups: null, filters, steps: engineerFunnelOf([]) };
    const codeIds = codes.map((c) => c.code);
    const stepRows = await bounded(prisma.$queryRaw<{ code: string; step: string; at: Date }[]>`
      SELECT meta->>'code' AS code, meta->>'step' AS step, min(ts) AS at FROM "Event"
      WHERE name = 'claim_step' AND meta->>'code' = ANY(${codeIds}::text[]) GROUP BY 1, 2`);
    const claimSteps = new Map<string, Map<string, Date>>();
    for (const r of stepRows) {
      if (!claimSteps.has(r.code)) claimSteps.set(r.code, new Map());
      claimSteps.get(r.code)!.set(r.step, r.at);
    }
    const engineerIds = [...new Set(codes.map((c) => c.redeemedByEngineerId).filter((id): id is string => !!id && !marks.engineers.includes(id)))];
    const { byEngineer, firstOffer } = await engineerFacts(engineerIds, marks, filters.reason);
    const items: Item[] = codes.map((c) => {
      const steps = claimSteps.get(c.code) ?? new Map<string, Date>();
      const e = c.redeemedByEngineerId ? byEngineer.get(c.redeemedByEngineerId) : undefined;
      const storeAt = steps.get("store_opened") ?? steps.get("store_fallback_tapped") ?? steps.get("app_link_opened") ?? null;
      const posted = postedOn.get(c.letterBatch);
      return {
        letters_posted: yes(posted ? ukMidnight(dayOf(posted)) : c.createdAt),
        claim_scans: when(steps.get("scan")),
        details_completed: c.claimedAt ? yes(steps.get("form_completed") ?? c.claimedAt) : when(steps.get("form_completed")),
        store_opened: when(storeAt),
        store_downloads: no,
        signed_up: e ? yes(c.redeemedAt) : no,
        ...afterSignup(e, firstOffer),
      };
    });
    return { start: "letters" as const, batches: new Set(codes.map((c) => c.letterBatch)).size, letters: codes.length, signups: null, filters, steps: engineerFunnelOf(items) };
  });
}

function afterSignup(e: EngineerRow | undefined, firstOffer: Map<string, Date>): Omit<Item, "letters_posted" | "claim_scans" | "details_completed" | "store_opened" | "store_downloads" | "signed_up"> {
  return {
    card_uploaded: e && (e.gasSafeCardUrl || e.cardAddedAt) ? yes(e.cardAddedAt) : no,
    card_check_passed: e ? when(e.gasSafeVerifiedAt) : no,
    plans_live_stage1: e && e.tierLive && e.stripeDetailsSubmitted ? yes(e.accountCompletedAt) : no,
    first_offer: e ? when(firstOffer.get(e.id)) : no,
    first_customer: e ? when(e.firstCustomerAt) : no,
    stage2_done: e?.stripePayoutsEnabled ? yes(null) : no,
    first_payout: e ? when(e.firstPayoutAt) : no,
    register_check_passed: e ? when(e.gasSafeRegisterCheckedAt) : no,
  };
}

async function engineerFacts(engineerIds: string[], marks: Awaited<ReturnType<typeof testMarks>>, reason: string | undefined) {
  const reasonSql = reason ? Prisma.sql`AND p."visitReason" = ${reason}` : Prisma.empty;
  const engineers = engineerIds.length
    ? await bounded(prisma.$queryRaw<EngineerRow[]>`
        WITH e AS (
          SELECT id, "gasSafeCardUrl",
            CASE WHEN "gasSafeCardReadId" IS NOT NULL THEN "gasSafeVerifiedAt" END AS "gasSafeVerifiedAt",
            "stripeAccountId", "stripeDetailsSubmitted", "stripePayoutsEnabled", "accountCompletedAt",
            CASE WHEN "gasSafeCardReadId" IS NOT NULL THEN "gasSafeRegisterCheckedAt" END AS "gasSafeRegisterCheckedAt"
          FROM "Engineer" WHERE id = ANY(${engineerIds}::text[]) AND "deletedAt" IS NULL
        )
        SELECT e.*,
          EXISTS (SELECT 1 FROM "PlanTier" t WHERE t."engineerId" = e.id AND t.status IN ('LIVE', 'STOPPED')) AS "tierLive",
          (SELECT min(p."activatedAt") FROM "Plan" p WHERE p."engineerId" = e.id AND p."activatedAt" IS NOT NULL
             AND NOT (p."customerId" = ANY(${marks.customers}::text[])) ${reasonSql}) AS "firstCustomerAt",
          (SELECT min(ts) FROM "Event" ev WHERE ev.name = 'gas_safe_card_added' AND ev."actorId" = e.id) AS "cardAddedAt",
          (SELECT min(w."processedAt") FROM "StripeWebhookEvent" w WHERE w.type = 'payout.paid' AND w.payload->>'account' = e."stripeAccountId") AS "firstPayoutAt"
        FROM e`)
    : [];
  const byEngineer = new Map(engineers.map((e) => [e.id, e]));
  const sentOffers = engineerIds.length ? await offers(marks, { engineerIds }) : [];
  const reasonOf = reason
    ? new Map((await prisma.plan.findMany({ where: { id: { in: sentOffers.map((o) => o.planId) } }, select: { id: true, visitReason: true } })).map((p) => [p.id, p.visitReason]))
    : null;
  const firstOffer = new Map<string, Date>();
  for (const o of sentOffers) {
    if (o.delivery !== "delivered") continue;
    if (reasonOf && reasonOf.get(o.planId) !== reason) continue;
    const seen = firstOffer.get(o.engineerId);
    if (!seen || o.sentAt < seen) firstOffer.set(o.engineerId, o.sentAt);
  }
  return { byEngineer, firstOffer };
}

export const CHANNEL_OF_SQL = Prisma.sql`CASE
  WHEN cc.code IS NOT NULL THEN 'letter'
  WHEN e.attribution->>'heardVia' = 'engineer' OR COALESCE(e.attribution->>'referralCode', '') <> '' THEN 'referral'
  WHEN e.attribution->>'heardVia' = 'online' THEN 'website'
  WHEN e.attribution->>'heardVia' = 'job' THEN 'job'
  ELSE 'other' END`;

export function engineerFunnelFromSignups(range: Range, filters: EngineerFunnelFilters & { channel: Exclude<FunnelChannel, "letter"> }) {
  const key = [range.from.toISOString(), range.to.toISOString(), filters.channel, filters.town ?? "", filters.reason ?? ""].join(":");
  return shared(`engineer-funnel-signups:${key}`, async () => {
    const marks = await testMarks();
    const channelSql = filters.channel === "all" ? Prisma.empty : Prisma.sql`AND ${CHANNEL_OF_SQL} = ${filters.channel}`;
    const townSql = filters.town ? Prisma.sql`AND lower(e.town) = lower(${filters.town})` : Prisma.empty;
    const rows = await bounded(prisma.$queryRaw<{ id: string; createdAt: Date }[]>`
      SELECT e.id, e."createdAt" FROM "Engineer" e LEFT JOIN "ClaimCode" cc ON cc."redeemedByEngineerId" = e.id
      WHERE e."ownerId" IS NULL AND e."deletedAt" IS NULL AND NOT (e.id = ANY(${marks.engineers}::text[]))
        AND e."createdAt" >= ${range.from} AND e."createdAt" < ${range.to} ${channelSql} ${townSql}`);
    const { byEngineer, firstOffer } = await engineerFacts(rows.map((r) => r.id), marks, filters.reason);
    const items: Item[] = rows.map((r) => ({
      letters_posted: yes(r.createdAt),
      claim_scans: no,
      details_completed: no,
      store_opened: no,
      store_downloads: no,
      signed_up: yes(r.createdAt),
      ...afterSignup(byEngineer.get(r.id), firstOffer),
    }));
    return { start: "signups" as const, batches: 0, letters: 0, signups: rows.length, filters, steps: engineerFunnelOf(items, "signups") };
  });
}
