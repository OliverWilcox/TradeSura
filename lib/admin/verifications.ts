import { createHash } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { CLAUSE_TEMPLATES } from "@/lib/clauses";
import { confirmedQualifications } from "@/lib/plan-rules";
import { companyOfficers } from "@/lib/companies-house";
import { matchPersonName, type NameMatch } from "@/lib/admin/names";
import { offerNearbyEngineers } from "@/lib/installer-leaves";
import { businessTypeMismatch, companyProfile, searchCompanies } from "@/lib/admin/companies";
import { maskEmail, maskPhone } from "@/lib/admin/mask";
import { displayName } from "@/lib/engineer";
import { notifyEngineer, smsConfigured } from "@/lib/sms";
import { emailConfigured, sendEmail } from "@/lib/email";
import { noticeEmail } from "@/lib/admin/notice-email";
import { sendVerifiedEmail } from "@/lib/verified-email";
import { sendPushNotification } from "@/lib/push";
import { standingState } from "@/lib/verification-state";
import { adminEvent } from "@/lib/admin-api/audit";
import { likeTerm } from "@/lib/admin-api/db";
import { AdminApiError, conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { formatUkDate, ukDay } from "@/lib/admin/time";
import { GAS_SAFE_REGISTER_URL } from "@/lib/gas-safe-register-link";

// The Gas Safe check for the admin API, with who decided recorded against
// each step. Live first, register check behind (Matt, 4 Nov): passing the
// card check puts the engineer live; the checker then checks the live Gas
// Safe Register the same day and records what it showed. Nothing is checked
// against a stored copy of the register. A case shows only what the check
// needs, no contact details, because verification checkers see it too.

/**
 * Where a case stands:
 *   no_card      a Gas Safe number but no card photo yet
 *   card         card photo in, card check waiting
 *   register     card check passed (live), register check due
 *   recheck      register checked before and due again
 *   passed       register check passed, not due again yet
 *   card_failed  card check failed (rejected)
 *   suspended    register check failed: badge, town page and offers off
 */
export type CheckStage = "not_submitted" | "no_card" | "card" | "register" | "recheck" | "passed" | "card_failed" | "suspended";
export type CardCheck = "waiting" | "passed" | "failed" | "no_card";
export type RegisterCheck = "due" | "recheck_due" | "passed" | "suspended";

const OPEN_STAGES = ["card", "register", "no_card", "recheck"] as const;
type OpenStage = (typeof OPEN_STAGES)[number];
const isOpen = (s: CheckStage): s is OpenStage => (OPEN_STAGES as readonly string[]).includes(s);

/** The queue's tabs: one per open stage, flagged duplicates across them, and decided. pending is card, register and recheck together (what needs a person). */
export type VerificationTab = OpenStage | "duplicates" | "pending" | "decided";

const live = { deletedAt: null } satisfies Prisma.EngineerWhereInput;

/** A date-only column (the card's expiry) as YYYY-MM-DD. */
export const dateOnly = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** The qualifications an engineer confirmed holding (to sell plan options that need them), with each option's name. */
export function qualificationsOf(raw: unknown) {
  return Object.entries(confirmedQualifications(raw)).map(([code, at]) => ({
    code,
    title: CLAUSE_TEMPLATES.find((c) => c.code === code)?.title ?? code,
    confirmedAt: at,
  }));
}

const DAY_MS = 86_400_000;
/** The yearly register re-check falls due this many days after the card's expiry (Matt, 4 Nov). */
export const RECHECK_DAYS_AFTER_CARD_EXPIRY = 14;
/** Without a card date, the register is checked again this many months after the last check. */
export const REGISTER_RECHECK_MONTHS = 12;
/** Cards renew yearly, so an expiry further off than this is flagged (Matt, 4 Nov: "more than about 13 months"). */
export const CARD_EXPIRY_FLAG_DAYS = 396;

/** When the register check is next due after the one passed at `checkedAt`. */
export function nextRegisterCheck(checkedAt: Date | null, cardExpiresOn: Date | null): Date | null {
  if (!checkedAt) return null;
  if (cardExpiresOn) {
    const due = new Date(cardExpiresOn.getTime() + RECHECK_DAYS_AFTER_CARD_EXPIRY * DAY_MS);
    // A card that had already lapsed when it was checked doesn't make the check due again at once.
    if (due > checkedAt) return due;
  }
  const due = new Date(checkedAt);
  due.setUTCMonth(due.getUTCMonth() + REGISTER_RECHECK_MONTHS);
  return due;
}

type CheckFields = {
  gasSafeNo: string | null;
  gasSafeCardUrl: string | null;
  gasSafeCardExpiresOn: Date | null;
  gasSafeVerifiedAt: Date | null;
  gasSafeRejectedAt: Date | null;
  gasSafeRegisterCheckedAt: Date | null;
  gasSafeSuspendedAt: Date | null;
  gasSafeRecheckRequestedAt: Date | null;
};

export function stageOf(e: CheckFields, now = new Date()): CheckStage {
  if (e.gasSafeVerifiedAt) {
    if (!e.gasSafeRegisterCheckedAt) return "register";
    const due = nextRegisterCheck(e.gasSafeRegisterCheckedAt, e.gasSafeCardExpiresOn);
    return e.gasSafeRecheckRequestedAt || (due && due <= now) ? "recheck" : "passed";
  }
  if (e.gasSafeRejectedAt) return e.gasSafeSuspendedAt ? "suspended" : "card_failed";
  if (!e.gasSafeNo) return "not_submitted";
  return e.gasSafeCardUrl ? "card" : "no_card";
}

/** The two results the queue and the engineers list show (Matt, 4 Nov), instead of one "pending". */
export function checksOf(e: CheckFields, now = new Date()) {
  const stage = stageOf(e, now);
  const card: CardCheck | null =
    stage === "not_submitted" ? null : stage === "no_card" ? "no_card" : stage === "card" ? "waiting" : stage === "card_failed" ? "failed" : "passed";
  // Suspended stays shown while a new card waits, so the checker sees why.
  const register: RegisterCheck | null =
    e.gasSafeSuspendedAt && !e.gasSafeVerifiedAt ? "suspended" : stage === "register" ? "due" : stage === "recheck" ? "recheck_due" : stage === "passed" ? "passed" : null;
  return { stage, card, register };
}

/**
 * The engineer's own licence number and the business's registration number.
 * Before the app asked for both, its one field was labelled "registration
 * number", so a number there that isn't a 7-digit licence is taken as that.
 */
export function gasSafeNumbers(e: { gasSafeNo: string | null; gasSafeRegistrationNo: string | null }) {
  const licenceNo = e.gasSafeNo && /^\d{7}$/.test(e.gasSafeNo) ? e.gasSafeNo : null;
  return { licenceNo, registrationNo: e.gasSafeRegistrationNo ?? (licenceNo ? null : e.gasSafeNo) };
}

/** How long opening an application holds it for one admin (refreshed while it's open). */
export const CLAIM_MINUTES = 15;
const claimCutoff = () => new Date(Date.now() - CLAIM_MINUTES * 60_000);

async function freshClaims(engineerIds: string[]) {
  if (!engineerIds.length) return new Map<string, { adminId: string; adminName: string; claimedAt: Date }>();
  const claims = await prisma.verificationClaim.findMany({ where: { engineerId: { in: engineerIds }, claimedAt: { gt: claimCutoff() } } });
  return new Map(claims.map((c) => [c.engineerId, c]));
}

const lockOf = (c: { adminId: string; adminName: string; claimedAt: Date } | undefined) =>
  c ? { holderId: c.adminId, holderName: c.adminName, until: new Date(c.claimedAt.getTime() + CLAIM_MINUTES * 60_000).toISOString() } : null;

const CHECK_SELECT = {
  gasSafeNo: true,
  gasSafeReviewRequestedAt: true,
  gasSafeRegistrationNo: true,
  gasSafeCardUrl: true,
  gasSafeCardExpiresOn: true,
  gasSafeVerifiedAt: true,
  gasSafeRejectedAt: true,
  gasSafeRejectReason: true,
  gasSafeRegisterCheckedAt: true,
  gasSafeSuspendedAt: true,
  gasSafeRecheckRequestedAt: true,
  gasSafeRecheckReason: true,
} satisfies Prisma.EngineerSelect;

const ROW_SELECT = {
  ...CHECK_SELECT,
  id: true,
  slug: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  businessType: true,
  companyNumber: true,
  companyStatus: true,
  postcode: true,
  town: true,
  gasSafeCategories: true,
  qualificationConfirmations: true,
  setupTextConsentAt: true,
  // Only whether there is one (a chase by text needs it); never sent on.
  phone: true,
  ownerId: true,
  owner: { select: { tradingName: true, legalName: true, slug: true, gasSafeNo: true, gasSafeRegistrationNo: true } },
  createdAt: true,
} satisfies Prisma.EngineerSelect;

type Row = Prisma.EngineerGetPayload<{ select: typeof ROW_SELECT }>;

/** Staff take the business's registration number from the owner when they haven't given one. */
function numbersOf(r: Row) {
  const own = gasSafeNumbers(r);
  return { licenceNo: own.licenceNo, registrationNo: own.registrationNo ?? (r.owner ? gasSafeNumbers(r.owner).registrationNo : null) };
}

/** What the checker looked at. If any of it changes, a decision made on the old view is refused. */
const REVISION_SELECT = {
  gasSafeNo: true,
  gasSafeRegistrationNo: true,
  gasSafeCardUrl: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  businessType: true,
  companyNumber: true,
  gasSafeVerifiedAt: true,
  gasSafeRejectedAt: true,
  gasSafeRegisterCheckedAt: true,
  gasSafeSuspendedAt: true,
} satisfies Prisma.EngineerSelect;

export function revisionOf(e: Prisma.EngineerGetPayload<{ select: typeof REVISION_SELECT }>): string {
  const parts = [
    e.gasSafeNo,
    e.gasSafeRegistrationNo,
    e.gasSafeCardUrl,
    e.firstName,
    e.lastName,
    e.tradingName,
    e.legalName,
    e.businessType,
    e.companyNumber,
    e.gasSafeVerifiedAt?.toISOString(),
    e.gasSafeRejectedAt?.toISOString(),
    e.gasSafeRegisterCheckedAt?.toISOString(),
    e.gasSafeSuspendedAt?.toISOString(),
  ];
  return createHash("sha256").update(JSON.stringify(parts.map((p) => p ?? null))).digest("hex").slice(0, 16);
}

export function personName(e: { firstName: string | null; lastName: string | null }) {
  return [e.firstName, e.lastName].filter(Boolean).join(" ").trim() || "Name not given";
}

export function verificationStatus(e: Pick<Row, "gasSafeNo" | "gasSafeVerifiedAt" | "gasSafeRejectedAt">) {
  if (e.gasSafeVerifiedAt) return "verified" as const;
  if (e.gasSafeRejectedAt) return "rejected" as const;
  return e.gasSafeNo ? ("pending" as const) : ("not_submitted" as const);
}

type DuplicateReason = "company_number" | "registration_number" | "business_name" | "name_and_postcode";
export type Duplicate = { engineerId: string; reason: DuplicateReason; name: string; business: string; status: string };

/** A business name to compare on: lower case, letters and digits only, without a closing Ltd, Limited, PLC or LLP. */
export function businessKey(name: string | null): string | null {
  const key = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(ltd|limited|plc|llp)$/, "");
  return key.length >= 4 ? key : null;
}

/** businessKey() in SQL, for one column. */
const businessKeySql = (column: "tradingName" | "legalName") =>
  Prisma.sql`regexp_replace(regexp_replace(lower(COALESCE(${Prisma.raw(`"${column}"`)}, '')), '[^a-z0-9]+', '', 'g'), '(ltd|limited|plc|llp)$', '')`;

const keysOf = (e: { tradingName: string | null; legalName: string | null }) => [businessKey(e.tradingName), businessKey(e.legalName)].filter((k): k is string => !!k);

/**
 * Other accounts that look like the same business or person: the same
 * company number, Gas Safe registration number or business name, or the same
 * name and postcode. Staff sit under their owner's business (Matt, 4 Nov):
 * never the business's duplicates, and compared with others only as people.
 * A signal for the checker, never a decision.
 */
async function duplicatesFor(rows: Row[]): Promise<Map<string, Duplicate[]>> {
  const result = new Map<string, Duplicate[]>(rows.map((r) => [r.id, []]));
  const companyNumbers = [...new Set(rows.map((r) => r.companyNumber).filter((n): n is string => !!n))];
  const postcodes = [...new Set(rows.map((r) => r.postcode).filter((p): p is string => !!p))];
  const registrations = [...new Set(rows.map((r) => numbersOf(r).registrationNo).filter((n): n is string => !!n))];
  const keys = [...new Set(rows.flatMap(keysOf))];
  const named = keys.length
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Engineer"
        WHERE "deletedAt" IS NULL AND (${businessKeySql("tradingName")} IN (${Prisma.join(keys)}) OR ${businessKeySql("legalName")} IN (${Prisma.join(keys)}))`
    : [];
  if (!companyNumbers.length && !postcodes.length && !registrations.length && !named.length) return result;
  const others = await prisma.engineer.findMany({
    where: {
      ...live,
      OR: [
        ...(companyNumbers.length ? [{ companyNumber: { in: companyNumbers } }] : []),
        ...(postcodes.length ? [{ postcode: { in: postcodes } }] : []),
        ...(registrations.length ? [{ gasSafeRegistrationNo: { in: registrations } }, { gasSafeNo: { in: registrations } }] : []),
        ...(named.length ? [{ id: { in: named.map((n) => n.id) } }] : []),
      ],
    },
    select: { ...ROW_SELECT, bannedAt: true },
  });
  const key = (e: { firstName: string | null; lastName: string | null }) => personName(e).toLowerCase();
  for (const row of rows) {
    const rowKeys = new Set(keysOf(row));
    const rowRegistration = numbersOf(row).registrationNo;
    for (const o of others) {
      const sameBusiness = o.id === row.id || o.id === row.ownerId || o.ownerId === row.id || (!!row.ownerId && o.ownerId === row.ownerId);
      if (sameBusiness) continue;
      // Staff carry their owner's business details, so only owners are compared as businesses.
      const businesses = !row.ownerId && !o.ownerId;
      const reason: DuplicateReason | null =
        businesses && row.companyNumber && o.companyNumber === row.companyNumber
          ? "company_number"
          : businesses && rowRegistration && numbersOf(o).registrationNo === rowRegistration
            ? "registration_number"
            : businesses && keysOf(o).some((k) => rowKeys.has(k))
              ? "business_name"
              : row.postcode && o.postcode === row.postcode && row.firstName && key(o) === key(row)
                ? "name_and_postcode"
                : null;
      if (reason) {
        result.get(row.id)!.push({
          engineerId: o.id,
          reason,
          name: personName(o),
          business: displayName(o),
          status: o.bannedAt ? "banned" : verificationStatus(o),
        });
      }
    }
  }
  return result;
}

/** When each engineer last uploaded a card (null if only at sign-up). */
async function lastUploads(rows: Row[]): Promise<Map<string, Date>> {
  const ids = rows.map((r) => r.id);
  const uploads = ids.length
    ? await prisma.event.groupBy({ by: ["actorId"], where: { name: "gas_safe_card_added", actorId: { in: ids } }, _max: { ts: true } })
    : [];
  return new Map(uploads.map((u) => [u.actorId!, u._max.ts!]));
}

/**
 * Since when a case has waited at its stage, which is what the waiting time
 * and its colours run from: the latest card upload (or sign-up) for a card
 * check, going live for a register check, the due date or the request for a
 * re-check.
 */
function waitingSinceOf(r: Row, stage: CheckStage, uploads: Map<string, Date>, now: Date): Date | null {
  if (stage === "card") return uploads.get(r.id) ?? r.createdAt;
  if (stage === "no_card") return r.createdAt;
  if (stage === "register") return r.gasSafeVerifiedAt;
  if (stage === "recheck") {
    const due = nextRegisterCheck(r.gasSafeRegisterCheckedAt, r.gasSafeCardExpiresOn);
    const since = [r.gasSafeRecheckRequestedAt, due && due <= now ? due : null].filter((d): d is Date => !!d);
    return since.length ? new Date(Math.min(...since.map((d) => d.getTime()))) : now;
  }
  return null;
}

/** The business name as displayName() shows it, for sorting in SQL. */
const BUSINESS_SQL = Prisma.sql`lower(COALESCE(NULLIF(trim("tradingName"), ''), NULLIF(trim("legalName"), ''), slug))`;

/** Decided: register check passed, card check failed, or suspended. */
const DECIDED_WHERE = {
  ...live,
  OR: [
    { gasSafeVerifiedAt: { not: null }, gasSafeRegisterCheckedAt: { not: null } },
    { gasSafeVerifiedAt: null, gasSafeRejectedAt: { not: null } },
  ],
} satisfies Prisma.EngineerWhereInput;
const DECIDED_SQL = Prisma.sql`(("gasSafeVerifiedAt" IS NOT NULL AND "gasSafeRegisterCheckedAt" IS NOT NULL) OR ("gasSafeVerifiedAt" IS NULL AND "gasSafeRejectedAt" IS NOT NULL))`;
/** The latest decision on a decided case. */
const DECIDED_AT_SQL = Prisma.sql`GREATEST("gasSafeRegisterCheckedAt", "gasSafeRejectedAt")`;
const decidedAtOf = (r: Row) => (r.gasSafeVerifiedAt ? r.gasSafeRegisterCheckedAt : r.gasSafeRejectedAt);

function searchWhere(q: string | undefined): Prisma.EngineerWhereInput {
  if (!q) return {};
  const contains = { contains: likeTerm(q), mode: "insensitive" as const };
  const digits = q.replace(/\D/g, "");
  return {
    OR: [
      { firstName: contains },
      { lastName: contains },
      { tradingName: contains },
      { legalName: contains },
      ...(digits.length >= 3 ? [{ gasSafeNo: { contains: digits } }, { gasSafeRegistrationNo: { contains: digits } }, { companyNumber: { contains: digits } }] : []),
    ],
  };
}

/** The same search, for the one raw query (decided, ordered by its latest decision). */
function searchSql(q: string | undefined) {
  if (!q) return Prisma.empty;
  const like = `%${likeTerm(q)}%`;
  const digits = q.replace(/\D/g, "");
  return Prisma.sql`AND ("firstName" ILIKE ${like} OR "lastName" ILIKE ${like} OR "tradingName" ILIKE ${like} OR "legalName" ILIKE ${like}
    ${digits.length >= 3 ? Prisma.sql`OR "gasSafeNo" LIKE ${`%${digits}%`} OR "gasSafeRegistrationNo" LIKE ${`%${digits}%`} OR "companyNumber" LIKE ${`%${digits}%`}` : Prisma.empty})`;
}

type QueueItem = { row: Row; stage: OpenStage; since: Date };

/**
 * Every open case, longest waiting first, with each one's duplicate signals.
 * The database picks out what might be open; stageOf() has the last word.
 * The queue is short, so it's loaded whole.
 */
async function openQueue(q?: string) {
  const now = new Date();
  const yearAgo = new Date(now);
  yearAgo.setUTCMonth(yearAgo.getUTCMonth() - REGISTER_RECHECK_MONTHS);
  const rows = await prisma.engineer.findMany({
    where: {
      AND: [
        live,
        searchWhere(q),
        {
          OR: [
            { gasSafeNo: { not: null }, gasSafeVerifiedAt: null, gasSafeRejectedAt: null },
            { gasSafeVerifiedAt: { not: null }, gasSafeRegisterCheckedAt: null },
            {
              gasSafeVerifiedAt: { not: null },
              OR: [{ gasSafeRecheckRequestedAt: { not: null } }, { gasSafeCardExpiresOn: { lte: now } }, { gasSafeRegisterCheckedAt: { lte: yearAgo } }],
            },
          ],
        },
      ],
    },
    select: ROW_SELECT,
  });
  const uploads = await lastUploads(rows);
  const items: QueueItem[] = rows
    .flatMap((row) => {
      const stage = stageOf(row, now);
      return isOpen(stage) ? [{ row, stage, since: waitingSinceOf(row, stage, uploads, now)! }] : [];
    })
    .sort((a, b) => a.since.getTime() - b.since.getTime() || a.row.id.localeCompare(b.row.id));
  return { items, duplicates: await duplicatesFor(items.map((i) => i.row)), uploads };
}

type OpenQueue = Awaited<ReturnType<typeof openQueue>>;

const inTab = (tab: VerificationTab, i: QueueItem, queue: OpenQueue) =>
  tab === "pending" ? i.stage !== "no_card" : tab === "duplicates" ? queue.duplicates.get(i.row.id)!.length > 0 : i.stage === tab;

/** Counts per tab. Pass the whole open queue if it's already loaded (unsearched), so it isn't loaded twice. */
export async function verificationCounts(loaded?: OpenQueue) {
  const [queue, decided] = await Promise.all([loaded ?? openQueue(), prisma.engineer.count({ where: DECIDED_WHERE })]);
  const count = (tab: VerificationTab) => queue.items.filter((i) => inTab(tab, i, queue)).length;
  return {
    card: count("card"),
    register: count("register"),
    no_card: count("no_card"),
    recheck: count("recheck"),
    duplicates: count("duplicates"),
    pending: count("pending"),
    decided,
  };
}

export async function listVerifications(q: {
  tab: VerificationTab;
  q?: string;
  sort?: "submitted" | "decided" | "name" | "business";
  dir?: "asc" | "desc";
  page: number;
  size: number;
}) {
  const skip = (q.page - 1) * q.size;
  const now = new Date();
  let rows: Row[];
  let total: number;
  let duplicates: Map<string, Duplicate[]>;
  let uploads: Map<string, Date>;
  let wholeQueue: OpenQueue | undefined;
  if (q.tab !== "decided") {
    const queue = await openQueue(q.q);
    if (!q.q) wholeQueue = queue;
    let found = queue.items.filter((i) => inTab(q.tab, i, queue));
    if (q.sort === "name" || q.sort === "business") {
      const by = q.sort === "name" ? (i: QueueItem) => `${i.row.lastName ?? ""} ${i.row.firstName ?? ""}` : (i: QueueItem) => displayName(i.row);
      found = [...found].sort((a, b) => by(a).localeCompare(by(b), "en-GB", { sensitivity: "base" }) || a.row.id.localeCompare(b.row.id));
    }
    if (q.dir === "desc") found = [...found].reverse();
    rows = found.slice(skip, skip + q.size).map((i) => i.row);
    total = found.length;
    duplicates = queue.duplicates;
    uploads = queue.uploads;
  } else {
    const dir = q.dir === "asc" || (q.sort === "business" && !q.dir) || (q.sort === "name" && !q.dir) ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const order = q.sort === "business" ? BUSINESS_SQL : q.sort === "name" ? Prisma.sql`lower(COALESCE("lastName", '') || ' ' || COALESCE("firstName", ''))` : DECIDED_AT_SQL;
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Engineer"
      WHERE "deletedAt" IS NULL AND ${DECIDED_SQL} ${searchSql(q.q)}
      ORDER BY ${order} ${dir}, id
      LIMIT ${q.size} OFFSET ${skip}`;
    const byId = new Map((await prisma.engineer.findMany({ where: { id: { in: ids.map((i) => i.id) } }, select: ROW_SELECT })).map((r) => [r.id, r]));
    rows = ids.map((i) => byId.get(i.id)!).filter(Boolean);
    total = await prisma.engineer.count({ where: { AND: [DECIDED_WHERE, searchWhere(q.q)] } });
    [duplicates, uploads] = await Promise.all([duplicatesFor(rows), lastUploads(rows)]);
  }
  const [claims, counts] = await Promise.all([freshClaims(rows.map((r) => r.id)), verificationCounts(wholeQueue)]);
  const items = rows.map((r) => {
    const checks = checksOf(r, now);
    const since = waitingSinceOf(r, checks.stage, uploads, now);
    return {
      id: r.id,
      name: personName(r),
      business: displayName(r),
      businessType: r.businessType,
      teamOf: r.owner ? displayName(r.owner) : null,
      ...numbersOf(r),
      town: r.town,
      cardExpiry: dateOnly(r.gasSafeCardExpiresOn),
      submittedAt: r.createdAt.toISOString(),
      waitingSince: since?.toISOString() ?? null,
      stage: checks.stage,
      cardCheck: checks.card,
      registerCheck: checks.register,
      liveSince: r.gasSafeVerifiedAt?.toISOString() ?? null,
      nextRecheck: dateOnly(nextRegisterCheck(r.gasSafeRegisterCheckedAt, r.gasSafeCardExpiresOn)),
      recheckReason: r.gasSafeRecheckReason,
      decidedAt: decidedAtOf(r)?.toISOString() ?? null,
      rejectReason: r.gasSafeRejectReason,
      claimedBy: claims.get(r.id)?.adminName ?? null,
      /** A chase can go by text: they have a mobile and agreed to texts about finishing setting up. */
      canTextChase: Boolean(r.phone && r.setupTextConsentAt),
      signals: {
        hasCard: Boolean(r.gasSafeCardUrl),
        cardExpiryFar: cardExpiryFar(r.gasSafeCardExpiresOn, now),
        companyNotActive: Boolean(r.companyStatus && r.companyStatus !== "active"),
        typeMismatch: businessTypeMismatch(r),
        duplicates: duplicates.get(r.id)?.length ?? 0,
      },
    };
  });
  return { items, page: q.page, size: q.size, total, counts };
}

/** The card says it runs further than a yearly renewal would. */
function cardExpiryFar(expiresOn: Date | null, now = new Date()) {
  return Boolean(expiresOn && expiresOn.getTime() > now.getTime() + CARD_EXPIRY_FLAG_DAYS * DAY_MS);
}

/** Every step of the check, newest first, by the event each one recorded. */
const CHECK_EVENTS: Record<string, "card_passed" | "card_failed" | "register_passed" | "suspended" | "recheck_requested"> = {
  gas_safe_verified: "card_passed",
  gas_safe_rejected: "card_failed",
  gas_safe_register_checked: "register_passed",
  gas_safe_suspended: "suspended",
  gas_safe_recheck_requested: "recheck_requested",
};

async function checkHistory(engineerId: string) {
  const events = await prisma.event.findMany({
    where: { name: { in: Object.keys(CHECK_EVENTS) }, meta: { path: ["engineerId"], equals: engineerId } },
    orderBy: { ts: "desc" },
    take: 20,
  });
  return events.map((event) => {
    const meta = (event.meta ?? {}) as { adminName?: string; reason?: string | null; note?: string | null };
    return {
      kind: CHECK_EVENTS[event.name],
      at: event.ts.toISOString(),
      byName: meta.adminName ?? (event.actorType === "SYSTEM" ? "TradeSura team" : null),
      note: meta.note ?? meta.reason ?? null,
    };
  });
}

export async function getVerification(engineerId: string, opts: { withContact?: boolean } = {}) {
  const row = await prisma.engineer.findFirst({
    where: { id: engineerId, ...live },
    select: {
      ...ROW_SELECT,
      bannedAt: true,
      banReason: true,
      pausedAt: true,
      pauseReason: true,
      stripeAccountId: true,
      stripeDetailsSubmitted: true,
      stripeChargesEnabled: true,
      email: true,
      phone: true,
      ...REVISION_SELECT,
      owner: { select: { id: true, tradingName: true, legalName: true, slug: true, gasSafeNo: true, gasSafeRegistrationNo: true } },
      _count: { select: { plans: { where: { status: { in: ["ACTIVE", "PAUSED"] } } } } },
    },
  });
  if (!row) return null;
  const now = new Date();
  // Before Companies House is asked: whether to look the name up there.
  const nameMismatch = businessTypeMismatch(row);
  const [duplicates, history, officers, claims, profile, search, uploads] = await Promise.all([
    duplicatesFor([row]),
    checkHistory(row.id),
    row.businessType === "ltd" && row.companyNumber ? companyOfficers(row.companyNumber) : Promise.resolve(null),
    freshClaims([row.id]),
    row.companyNumber ? companyProfile(row.companyNumber) : Promise.resolve(null),
    // A name that says it's a company with no company number given: look it up by name.
    nameMismatch === "name_says_company" && !row.companyNumber ? searchCompanies(row.legalName ?? row.tradingName ?? "") : Promise.resolve(null),
    lastUploads([row]),
  ]);
  const typeMismatch = businessTypeMismatch(row, profile?.name ?? null);
  const checks = checksOf(row, now);
  // Where it sits among the cases in the same tab.
  let queue = null;
  if (isOpen(checks.stage)) {
    const ids = (await openQueue()).items.filter((i) => i.stage === checks.stage).map((i) => i.row.id);
    const at = ids.indexOf(row.id);
    if (at >= 0) queue = { position: at + 1, total: ids.length, previousId: ids[at - 1] ?? null, nextId: ids[at + 1] ?? null };
  }
  const detail = {
    id: row.id,
    name: personName(row),
    firstName: row.firstName,
    lastName: row.lastName,
    business: displayName(row),
    tradingName: row.tradingName,
    legalName: row.legalName,
    businessType: row.businessType,
    teamOf: row.owner ? { id: row.owner.id, business: displayName(row.owner) } : null,
    submittedAt: row.createdAt.toISOString(),
    waitingSince: waitingSinceOf(row, checks.stage, uploads, now)?.toISOString() ?? null,
    stage: checks.stage,
    tab: isOpen(checks.stage) ? checks.stage : checks.stage === "not_submitted" ? null : ("decided" as const),
    /** Send back with a decision: if the case changes in the meantime, the decision is refused. */
    revision: revisionOf(row),
    standing: standingState(row),
    lock: lockOf(claims.get(row.id)),
    checks: {
      card: checks.card,
      register: checks.register,
      liveSince: row.gasSafeVerifiedAt?.toISOString() ?? null,
      registerCheckedAt: row.gasSafeRegisterCheckedAt?.toISOString() ?? null,
      nextRecheck: dateOnly(nextRegisterCheck(row.gasSafeRegisterCheckedAt, row.gasSafeCardExpiresOn)),
      recheckRequested: row.gasSafeRecheckRequestedAt ? { at: row.gasSafeRecheckRequestedAt.toISOString(), reason: row.gasSafeRecheckReason } : null,
      suspended: row.gasSafeSuspendedAt ? { at: row.gasSafeSuspendedAt.toISOString(), reason: row.gasSafeRejectReason } : null,
      failedReason: checks.stage === "card_failed" ? row.gasSafeRejectReason : null,
    },
    history,
    gasSafe: { ...numbersOf(row), registerUrl: GAS_SAFE_REGISTER_URL },
    /** What the engineer gave, for the checker to set beside the card and the register. The card's expiry is null until they give it with the photo. */
    submitted: { name: personName(row), business: displayName(row), categories: row.gasSafeCategories, postcode: row.postcode, town: row.town, cardExpiry: dateOnly(row.gasSafeCardExpiresOn) },
    /** Masked, for admins who may see contact details (the full value comes from the audited reveal). */
    contact: opts.withContact ? { email: maskEmail(row.email), phone: row.phone ? maskPhone(row.phone) : null } : null,
    /** A chase can go by text: they have a mobile and agreed to texts about finishing setting up. */
    canTextChase: Boolean(row.phone && row.setupTextConsentAt),
    /** Customers on a live plan, who'd be told if the engineer is suspended. Staff have none of their own. */
    customersOnPlans: row.ownerId ? 0 : row._count.plans,
    card: { available: Boolean(row.gasSafeCardUrl) },
    company:
      row.businessType === "ltd" || row.companyNumber
        ? {
            name: row.legalName ?? row.tradingName,
            number: row.companyNumber,
            status: row.companyStatus,
            officers:
              officers?.map((o) => {
                const match = matchPersonName(o.name, row.firstName, row.lastName);
                return { ...o, match, matchesApplicant: match !== "none" };
              }) ?? null,
            profile,
          }
        : null,
    /** 3.4: the business's name and type disagree, and what Companies House has under that name. */
    typeMismatch: typeMismatch ? { kind: typeMismatch, search } : null,
    qualifications: qualificationsOf(row.qualificationConfirmations),
    duplicates: duplicates.get(row.id)!,
    queue,
  };
  return { ...detail, warnings: caseWarnings(detail, now) };
}

export type VerificationDetail = NonNullable<Awaited<ReturnType<typeof getVerification>>>;

export type CaseWarning = { code: string; message: string };

const ukDate = (iso: string) => formatUkDate(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));

/** Everything still open on a case, in the words the checker sees: what passing a check over needs a note for. */
export function caseWarnings(
  d: {
    duplicates: unknown[];
    card: { available: boolean };
    submitted: { cardExpiry: string | null };
    checks: { suspended: { at: string; reason: string | null } | null; card: CardCheck | null };
    company: { status: string | null; officers: { match: NameMatch }[] | null } | null;
    typeMismatch: { kind: "name_says_company" | "type_says_company" } | null;
  },
  now = new Date(),
): CaseWarning[] {
  const w: CaseWarning[] = [];
  if (d.duplicates.length) w.push({ code: "duplicate", message: "Another account shares this company number, business name, Gas Safe registration number, or name and postcode." });
  if (!d.card.available) w.push({ code: "no_card", message: "There's no photo of their Gas Safe ID card." });
  const expiry = d.submitted.cardExpiry;
  if (expiry && expiry < ukDay(now)) w.push({ code: "card_expired", message: `Their Gas Safe ID card expired on ${ukDate(expiry)}.` });
  if (expiry && cardExpiryFar(new Date(`${expiry}T00:00:00Z`), now)) {
    w.push({ code: "card_expiry_far", message: `The card's expiry, ${ukDate(expiry)}, is more than 13 months away. Cards renew yearly.` });
  }
  if (d.checks.suspended && d.checks.card === "waiting") {
    w.push({ code: "was_suspended", message: `Suspended on ${ukDate(d.checks.suspended.at)}${d.checks.suspended.reason ? `: ${d.checks.suspended.reason}` : ""}.` });
  }
  if (d.company?.status && d.company.status !== "active") w.push({ code: "company_not_active", message: `The company is ${d.company.status} at Companies House.` });
  const officers = d.company?.officers;
  if (officers?.length && !officers.some((o) => o.match === "match")) {
    w.push(
      officers.some((o) => o.match === "likely")
        ? { code: "officer_likely", message: "The applicant is only a likely match for a company officer." }
        : { code: "no_officer", message: "No current company officer matches the applicant." },
    );
  }
  if (d.typeMismatch?.kind === "name_says_company") w.push({ code: "type_mismatch", message: "The business name says it's a company, but it was signed up as one that isn't." });
  if (d.typeMismatch?.kind === "type_says_company") w.push({ code: "type_mismatch", message: "It was signed up as a limited company, but the registered name doesn't say Ltd or Limited." });
  return w;
}

// --- Telling the engineer ----------------------------------------------------

/** Whether it went: false with no email on the account, or when email isn't set up here (the dev driver only prints it). Throws if the provider refused it. */
async function emailEngineer(engineerId: string, title: string, paragraphs: string[]): Promise<boolean> {
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { email: true, firstName: true } });
  if (!engineer?.email) return false;
  await sendEmail({ to: engineer.email, ...noticeEmail({ firstName: engineer.firstName, title, paragraphs }) });
  return emailConfigured();
}

type Outcome = "live" | "card_failed" | "suspended";

/** Push, text and email for each outcome. A failed send never undoes the decision. */
async function tellEngineer(engineerId: string, outcome: Outcome, reason: string | null) {
  const why = reason ? ` (${reason})` : "";
  const sends: Record<Outcome, (() => Promise<unknown>)[]> = {
    live: [
      () => sendPushNotification(engineerId, "You're live", "Your Gas Safe card is checked: your Verified Member badge is on", { url: "/more" }),
      () => notifyEngineer(engineerId, "Your Gas Safe card is checked and you're live on TradeSura: your Verified Member badge is on and you can send plan offers."),
      // The designed "You're verified" email, once per owner; otherwise (live again after a suspension, or a staff engineer) a plain notice.
      async () =>
        (await sendVerifiedEmail(engineerId)) ||
        emailEngineer(engineerId, "You're live on TradeSura", [
          "Good news: we've checked your Gas Safe ID card and your Verified Member badge is live.",
          "You can send plan offers straight away.",
        ]),
    ],
    card_failed: [
      () => notifyEngineer(engineerId, "We couldn't verify your Gas Safe number on TradeSura — open the app to check it and try again."),
      () =>
        emailEngineer(engineerId, "We couldn't verify your Gas Safe registration", [
          `We weren't able to verify your Gas Safe registration${why}.`,
          "Open the TradeSura app to check your number and ID card, then submit it again.",
        ]),
      () => sendPushNotification(engineerId, "Verification needs a look", "We couldn't verify your Gas Safe number — check it and try again.", { url: "/more" }),
    ],
    suspended: [
      () => notifyEngineer(engineerId, "TradeSura: we couldn't confirm your Gas Safe registration on the Gas Safe Register, so your account is suspended. Open the app to see why."),
      () =>
        emailEngineer(engineerId, "Your TradeSura account is suspended", [
          `We couldn't confirm your Gas Safe registration on the Gas Safe Register${why}, so your account is suspended: your Verified Member badge and town page are off, and offers are stopped.`,
          "Open the TradeSura app to check your details and add your current Gas Safe ID card. We'll check it again as soon as it's in.",
        ]),
      () => sendPushNotification(engineerId, "Account suspended", "We couldn't confirm your Gas Safe registration — open the app to see why.", { url: "/more" }),
    ],
  };
  for (const send of sends[outcome]) {
    try {
      await withTimeout<unknown>(send(), NOTICE_TIMEOUT_MS);
    } catch (err) {
      console.error("[admin-api] verification notice failed:", err);
    }
  }
}

/** Longest one push, text or email may take before the next is tried. */
const NOTICE_TIMEOUT_MS = 10_000;

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No answer after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Work for after the answer has gone back, so the admin isn't kept waiting on
 * text and email providers. Outside a Next.js request (scripts, tests) there's
 * no "after", so it runs straight away.
 */
export function afterResponse(task: () => Promise<void>): Promise<void> | void {
  try {
    after(task);
  } catch {
    return task();
  }
}

// --- Deciding ---------------------------------------------------------------

/**
 * Claim an open case for this admin, or refresh their claim. Someone else's
 * fresh claim wins: the answer then says who holds it. Claims on one case are
 * taken one at a time (a transaction-scoped advisory lock), so two admins
 * opening it together can't both get it.
 */
export async function claimVerification(admin: AdminPrincipal, engineerId: string) {
  const row = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: CHECK_SELECT });
  if (!row) throw notFound("There's no engineer with that ID.");
  if (!isOpen(stageOf(row))) return { claimed: false, lock: null };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`verification-claim:${engineerId}`}, 0))`;
    const current = await tx.verificationClaim.findUnique({ where: { engineerId } });
    const held = current && current.claimedAt > claimCutoff() ? current : null;
    if (held && held.adminId !== admin.id) return { claimed: false, lock: lockOf(held) };
    const saved = await tx.verificationClaim.upsert({
      where: { engineerId },
      create: { engineerId, adminId: admin.id, adminName: admin.name },
      update: { adminId: admin.id, adminName: admin.name, claimedAt: new Date() },
    });
    // The start of a check is recorded; refreshing it isn't.
    if (!held) await adminEvent(admin, "verification_claimed", { engineerId }, tx);
    return { claimed: true, lock: lockOf(saved) };
  });
}

/** The next case in the same tab, for "move straight on". */
async function nextInStage(engineerId: string, stage: CheckStage) {
  if (!isOpen(stage)) return null;
  return (await openQueue()).items.find((i) => i.stage === stage && i.row.id !== engineerId)?.row.id ?? null;
}

/**
 * One step of the check, made inside a transaction that holds the engineer's
 * row: refused if another admin holds the case, if it changed since it was
 * opened (revision), or if it's no longer at a stage the step applies to.
 */
async function checkStep<T>(
  admin: AdminPrincipal,
  engineerId: string,
  revision: string | undefined,
  allowed: CheckStage[],
  refused: string,
  step: (tx: Prisma.TransactionClient, row: Prisma.EngineerGetPayload<{ select: typeof CHECK_SELECT & typeof REVISION_SELECT }>, stage: CheckStage) => Promise<T>,
): Promise<T> {
  const held = (await freshClaims([engineerId])).get(engineerId);
  if (held && held.adminId !== admin.id) throw conflict(`${held.adminName} is checking this case right now. Try again once they've finished.`);
  return prisma.$transaction(async (tx) => {
    // Held until the transaction ends, so nothing changes between the check and the decision.
    await tx.$executeRaw`SELECT id FROM "Engineer" WHERE id = ${engineerId} FOR UPDATE`;
    const row = await tx.engineer.findFirst({ where: { id: engineerId, ...live }, select: { ...CHECK_SELECT, ...REVISION_SELECT } });
    if (!row) throw notFound("There's no engineer with that ID.");
    const stage = stageOf(row);
    if (!allowed.includes(stage)) throw conflict(refused);
    if (revision && revisionOf(row) !== revision) throw conflict("This case changed while you had it open. Reload to see the latest before deciding.");
    const result = await step(tx, row, stage);
    await tx.verificationClaim.deleteMany({ where: { engineerId } });
    return result;
  });
}

/**
 * The card check. Passing it puts the engineer live straight away (badge,
 * town page, offers), with the register check due behind it; it needs a card
 * photo. Failing it rejects the application, with the reason they're told.
 */
export async function decideVerification(
  admin: AdminPrincipal,
  engineerId: string,
  input: { decision: "approve" | "reject"; reason?: string | null; note?: string | null; duplicateOf?: string; revision?: string },
) {
  const approved = input.decision === "approve";
  // A rejection's reason and the checker's note travel separately (each up to
  // 500 characters) and are kept together, as the engineer is told them.
  const parts = [input.reason?.trim(), input.note?.trim()].filter(Boolean);
  const reason = parts.length ? parts.join(": ") : null;
  // 3.7: passing over open warnings takes a note saying why, kept with the decision.
  const current = approved ? await getVerification(engineerId) : null;
  const warnings = current?.stage === "card" ? current.warnings : [];
  if (input.duplicateOf && !(await prisma.engineer.count({ where: { id: input.duplicateOf, NOT: { id: engineerId } } }))) {
    throw notFound("The account it duplicates doesn't exist.");
  }
  const now = new Date();
  const stage = await checkStep(
    admin,
    engineerId,
    input.revision,
    ["card", "no_card"],
    "This application has already been decided.",
    async (tx, row, stage) => {
      if (!row.gasSafeNo) throw conflict("This engineer hasn't submitted a Gas Safe number yet.");
      // Nobody goes live on "Photo outstanding" (Matt, 4 Nov).
      if (approved && stage === "no_card") throw conflict("There's no card photo to check yet. Chase them for it.");
      if (approved && warnings.length && !reason) {
        throw new AdminApiError(400, "VALIDATION", "Say why you're passing it with open warnings.", { reason: ["Say why you're passing it with open warnings."] });
      }
      await tx.engineer.update({
        where: { id: engineerId },
        data: approved
          ? {
              gasSafeVerifiedAt: now,
              gasSafeRejectedAt: null,
              gasSafeRejectReason: null,
              gasSafeSuspendedAt: null,
              // Every pass of the card check is followed by a register check.
              gasSafeRegisterCheckedAt: null,
              gasSafeRecheckRequestedAt: null,
              gasSafeRecheckReason: null,
            }
          : { gasSafeRejectedAt: now, gasSafeRejectReason: reason },
      });
      await adminEvent(
        admin,
        approved ? "gas_safe_verified" : "gas_safe_rejected",
        { engineerId, reason, before: stage, ...(input.duplicateOf ? { duplicateOf: input.duplicateOf } : {}), ...(warnings.length ? { warnings: warnings.map((w) => w.code) } : {}) },
        tx,
      );
      return stage;
    },
  );
  await afterResponse(() => tellEngineer(engineerId, approved ? "live" : "card_failed", reason));
  return { id: engineerId, outcome: approved ? ("verified" as const) : ("rejected" as const), decidedAt: now.toISOString(), nextId: await nextInStage(engineerId, stage) };
}

/** Register check passed: the checker looked the licence up on the live Gas Safe Register and says what it showed. Member packs post only after this. */
export async function passRegisterCheck(admin: AdminPrincipal, engineerId: string, input: { note: string; revision?: string }) {
  const now = new Date();
  const stage = await checkStep(admin, engineerId, input.revision, ["register", "recheck"], "Their register check isn't due.", async (tx, _row, stage) => {
    await tx.engineer.update({
      where: { id: engineerId },
      data: { gasSafeRegisterCheckedAt: now, gasSafeRecheckRequestedAt: null, gasSafeRecheckReason: null },
    });
    await adminEvent(admin, "gas_safe_register_checked", { engineerId, note: input.note, recheck: stage === "recheck" }, tx);
    return stage;
  });
  return { id: engineerId, checkedAt: now.toISOString(), nextId: await nextInStage(engineerId, stage) };
}

/**
 * Suspend after a failed register check: the badge comes down, the town page
 * and offers stop (all read gasSafeVerifiedAt), and the reason is recorded.
 * With tellCustomers, each customer on a live plan is told and offered a
 * TradeSura engineer near them, as when an engineer leaves.
 */
export async function suspendEngineer(admin: AdminPrincipal, engineerId: string, input: { reason: string; tellCustomers: boolean; revision?: string }) {
  const now = new Date();
  const { stage, owner } = await checkStep(admin, engineerId, input.revision, ["register", "recheck", "passed"], "Only an engineer who's live can be suspended.", async (tx, _row, stage) => {
    const { ownerId } = await tx.engineer.update({
      where: { id: engineerId },
      data: {
        gasSafeVerifiedAt: null,
        gasSafeRejectedAt: now,
        gasSafeRejectReason: input.reason,
        gasSafeSuspendedAt: now,
        gasSafeRegisterCheckedAt: null,
        gasSafeRecheckRequestedAt: null,
        gasSafeRecheckReason: null,
      },
      select: { ownerId: true },
    });
    await adminEvent(admin, "gas_safe_suspended", { engineerId, reason: input.reason, before: stage, tellCustomers: input.tellCustomers }, tx);
    return { stage, owner: !ownerId };
  });
  await afterResponse(async () => {
    await tellEngineer(engineerId, "suspended", input.reason);
    if (input.tellCustomers && owner) {
      const { offered } = await offerNearbyEngineers(engineerId);
      await adminEvent(admin, "engineer_customers_told", { engineerId, offered, why: "suspended" });
    }
  });
  return { id: engineerId, suspendedAt: now.toISOString(), nextId: await nextInStage(engineerId, stage) };
}

/** An ad hoc register re-check (a homeowner's safety complaint), on top of the yearly one. */
export async function requestRecheck(admin: AdminPrincipal, engineerId: string, input: { reason: string }) {
  const now = new Date();
  await checkStep(admin, engineerId, undefined, ["passed", "recheck"], "Only an engineer whose register check has passed can be re-checked.", async (tx) => {
    await tx.engineer.update({ where: { id: engineerId }, data: { gasSafeRecheckRequestedAt: now, gasSafeRecheckReason: input.reason } });
    await adminEvent(admin, "gas_safe_recheck_requested", { engineerId, reason: input.reason }, tx);
  });
  return { id: engineerId, requestedAt: now.toISOString() };
}

// --- Chasing an applicant ----------------------------------------------------

export type ChaseWhat = "photo" | "details";

const CHASE_TEXT: Record<ChaseWhat, { sms: string; subject: string; paragraphs: string[] }> = {
  photo: {
    sms: "TradeSura here: to finish your Gas Safe check we need a photo of your Gas Safe ID card. Add it in the app under Settings, Gas Safe card.",
    subject: "Add your Gas Safe ID card to finish your check",
    paragraphs: [
      "To finish checking your Gas Safe registration we need a photo of your Gas Safe ID card.",
      "Open the TradeSura app and add it under Settings, Gas Safe card. We'll check it against the Gas Safe Register, usually within 24 hours.",
    ],
  },
  details: {
    sms: "TradeSura here: we couldn't match some of your details to the Gas Safe Register. Open the app to check your name and Gas Safe number.",
    subject: "Check your details to finish your Gas Safe check",
    paragraphs: [
      "We couldn't match some of your sign-up details to the Gas Safe Register.",
      "Open the TradeSura app to check that your name and Gas Safe number match your Gas Safe ID card.",
    ],
  },
};

/** Why a chase didn't go: text or email isn't set up on this server, or the provider refused it. */
export type NotSent = "not_configured" | "refused";

/**
 * Asks a waiting applicant for what's missing, by text (from TradeSura's own
 * number) or email. Only while the application is waiting. Says whether it
 * actually went (QA-05), and records it either way: verification_chased when
 * it went, verification_chase_failed when it didn't.
 */
export async function chaseApplicant(admin: AdminPrincipal, engineerId: string, input: { what: ChaseWhat; channel: "sms" | "email" }) {
  const row = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { gasSafeNo: true, gasSafeVerifiedAt: true, gasSafeRejectedAt: true, phone: true, email: true, setupTextConsentAt: true } });
  if (!row) throw notFound("There's no engineer with that ID.");
  if (verificationStatus(row) !== "pending") throw conflict("This application isn't waiting for a check.");
  if (input.channel === "sms" && !row.phone) throw conflict("There's no mobile number on this account.");
  // A chase is a setup text, which they have to have agreed to; email needs no opt-in.
  if (input.channel === "sms" && !row.setupTextConsentAt) throw conflict("They haven't agreed to texts about finishing setting up. Email them instead.");
  const text = CHASE_TEXT[input.what];
  let sent: boolean;
  try {
    sent = input.channel === "sms" ? await notifyEngineer(engineerId, text.sms) : await emailEngineer(engineerId, text.subject, text.paragraphs);
  } catch (err) {
    console.error("[admin-api] chase failed:", err);
    sent = false;
  }
  const configured = input.channel === "sms" ? smsConfigured() : emailConfigured();
  const notSent: NotSent | null = sent ? null : configured ? "refused" : "not_configured";
  await adminEvent(admin, sent ? "verification_chased" : "verification_chase_failed", { engineerId, what: input.what, channel: input.channel, ...(notSent ? { notSent } : {}) });
  return { chased: sent, channel: input.channel, notSent };
}

// --- The ID card photo ------------------------------------------------------

const CARD_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic"]);
const MAX_CARD_BYTES = 8 * 1024 * 1024;

/** Cards are stored in Vercel Blob; anywhere else is refused, so this can't be used to fetch other URLs. */
function cardSourceAllowed(url: URL): boolean {
  if (url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com")) return true;
  const extra = (process.env.ADMIN_CARD_EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return extra.includes(url.origin);
}

export async function fetchCard(engineerId: string): Promise<Response | null> {
  const row = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { gasSafeCardUrl: true } });
  if (!row?.gasSafeCardUrl) return null;
  let url: URL;
  try {
    url = new URL(row.gasSafeCardUrl);
  } catch {
    return null;
  }
  if (!cardSourceAllowed(url)) {
    console.error(`[admin-api] card for ${engineerId} isn't on an allowed host: ${url.host}`);
    return null;
  }
  const res = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !(CARD_TYPES.has(type) || (type === "image/svg+xml" && !url.hostname.endsWith(".vercel-storage.com")))) return null;
  // Refuse an oversized file before reading it, when the store says its size.
  if (Number(res.headers.get("content-length") ?? 0) > MAX_CARD_BYTES) return null;
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_CARD_BYTES) return null;
  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
