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
import { GAS_SAFE_REGISTER_URL, gasSafeRegisterSearch } from "@/lib/gas-safe-register-link";
import { autoPassOn, cardCheckView, cardPassBlock, currentReads, detailsOf, readComplete, type CardCheckView, type CardDetails } from "@/lib/admin/card-check";
import { cardReadConfigured, notSetUpReading, readGasSafeCard, type CardImage, type CardReading } from "@/lib/card-read";
import type { GasSafeCardRead } from "@/lib/generated/prisma/client";
import { isPrivateCardUrl, readPrivateCard } from "@/lib/gas-safe-card";

export type CheckStage = "not_submitted" | "no_card" | "card" | "register" | "recheck" | "passed" | "card_failed" | "suspended";
export type CardCheck = "waiting" | "passed" | "failed" | "no_card";
export type RegisterCheck = "due" | "recheck_due" | "passed" | "suspended";

const OPEN_STAGES = ["card", "register", "no_card", "recheck"] as const;
type OpenStage = (typeof OPEN_STAGES)[number];
const isOpen = (s: CheckStage): s is OpenStage => (OPEN_STAGES as readonly string[]).includes(s);

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
export const RECHECK_DAYS_AFTER_CARD_EXPIRY = 14;
export const REGISTER_RECHECK_MONTHS = 12;
export const CARD_EXPIRY_FLAG_DAYS = 396;

export function nextRegisterCheck(checkedAt: Date | null, cardExpiresOn: Date | null): Date | null {
  if (!checkedAt) return null;
  if (cardExpiresOn) {
    const due = new Date(cardExpiresOn.getTime() + RECHECK_DAYS_AFTER_CARD_EXPIRY * DAY_MS);
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
  gasSafeCardReadId: string | null;
};

export const PASSED_READ = { gasSafeCardReadId: { not: null } } as const;

export const cardCheckPassed = (e: Pick<CheckFields, "gasSafeVerifiedAt" | "gasSafeCardReadId">) => Boolean(e.gasSafeVerifiedAt && e.gasSafeCardReadId);

export function badgeOf(e: Pick<CheckFields, "gasSafeVerifiedAt" | "gasSafeCardReadId" | "gasSafeRegisterCheckedAt"> & { pausedAt: Date | null; bannedAt: Date | null }): "public" | "hidden" {
  return cardCheckPassed(e) && e.gasSafeRegisterCheckedAt && !e.pausedAt && !e.bannedAt ? "public" : "hidden";
}

export function stageOf(e: CheckFields, now = new Date()): CheckStage {
  if (e.gasSafeVerifiedAt && !e.gasSafeCardReadId) return e.gasSafeCardUrl ? "card" : "no_card";
  if (e.gasSafeVerifiedAt) {
    if (!e.gasSafeRegisterCheckedAt) return "register";
    const due = nextRegisterCheck(e.gasSafeRegisterCheckedAt, e.gasSafeCardExpiresOn);
    return e.gasSafeRecheckRequestedAt || (due && due <= now) ? "recheck" : "passed";
  }
  if (e.gasSafeRejectedAt) return e.gasSafeSuspendedAt ? "suspended" : "card_failed";
  if (!e.gasSafeNo) return "not_submitted";
  return e.gasSafeCardUrl ? "card" : "no_card";
}

export function checksOf(e: CheckFields, now = new Date()) {
  const stage = stageOf(e, now);
  const unread: CardCheck = e.gasSafeCardUrl ? "waiting" : "no_card";
  const card: CardCheck | null =
    stage === "not_submitted"
      ? null
      : stage === "no_card"
        ? "no_card"
        : stage === "card"
          ? "waiting"
          : stage === "card_failed"
            ? "failed"
            : stage === "suspended"
              ? e.gasSafeCardReadId
                ? "passed"
                : unread
              : "passed";
  const register: RegisterCheck | null =
    e.gasSafeSuspendedAt && !e.gasSafeVerifiedAt ? "suspended" : stage === "register" ? "due" : stage === "recheck" ? "recheck_due" : stage === "passed" ? "passed" : null;
  return { stage, card, register };
}

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
  gasSafeCardReadId: true,
  gasSafeCardBackUrl: true,
  pausedAt: true,
  bannedAt: true,
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
  gasSafeReopenedAt: true,
  gasSafeVerifiedBeforeReopenAt: true,
  gasSafeRegisterCheckedBeforeReopenAt: true,
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
  phone: true,
  ownerId: true,
  owner: { select: { tradingName: true, legalName: true, slug: true, gasSafeNo: true, gasSafeRegistrationNo: true } },
  createdAt: true,
} satisfies Prisma.EngineerSelect;

type Row = Prisma.EngineerGetPayload<{ select: typeof ROW_SELECT }>;

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

type DuplicateReason = "company_number" | "registration_number" | "business_name" | "email" | "name_and_postcode";
export type Duplicate = { engineerId: string; reason: DuplicateReason; name: string; business: string; status: string };

export function businessKey(name: string | null): string | null {
  const key = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(ltd|limited|plc|llp)$/, "");
  return key.length >= 4 ? key : null;
}

const businessKeySql = (column: "tradingName" | "legalName") =>
  Prisma.sql`regexp_replace(regexp_replace(lower(COALESCE(${Prisma.raw(`"${column}"`)}, '')), '[^a-z0-9]+', '', 'g'), '(ltd|limited|plc|llp)$', '')`;

const keysOf = (e: { tradingName: string | null; legalName: string | null }) => [businessKey(e.tradingName), businessKey(e.legalName)].filter((k): k is string => !!k);

export function emailKey(email: string | null): string | null {
  const [local = "", domain = ""] = (email ?? "").trim().toLowerCase().split("@");
  const base = local.split("+")[0];
  if (!base || !domain) return null;
  return domain === "gmail.com" || domain === "googlemail.com" ? `${base.replace(/\./g, "")}@gmail.com` : `${base}@${domain}`;
}

const EMAIL_KEY_SQL = Prisma.sql`CASE WHEN lower(split_part(email, '@', 2)) IN ('gmail.com', 'googlemail.com') THEN replace(lower(split_part(split_part(email, '@', 1), '+', 1)), '.', '') || '@gmail.com' ELSE lower(split_part(split_part(email, '@', 1), '+', 1)) || '@' || lower(split_part(email, '@', 2)) END`;

async function duplicatesFor(rows: Row[]): Promise<Map<string, Duplicate[]>> {
  const result = new Map<string, Duplicate[]>(rows.map((r) => [r.id, []]));
  const [reads, emails] = await Promise.all([
    currentReads(rows),
    prisma.engineer.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, email: true } }),
  ]);
  const emailOf = new Map(emails.map((e) => [e.id, emailKey(e.email)]));
  const registrationsOf = (r: Row) => [numbersOf(r).registrationNo, reads.get(r.id)?.read?.registrationNo ?? null].filter((n): n is string => !!n);
  const companyNumbers = [...new Set(rows.map((r) => r.companyNumber).filter((n): n is string => !!n))];
  const postcodes = [...new Set(rows.map((r) => r.postcode).filter((p): p is string => !!p))];
  const registrations = [...new Set(rows.flatMap(registrationsOf))];
  const keys = [...new Set(rows.flatMap(keysOf))];
  const emailKeys = [...new Set([...emailOf.values()].filter((k): k is string => !!k))];
  const [named, sameEmail] = await Promise.all([
    keys.length
      ? prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Engineer"
          WHERE "deletedAt" IS NULL AND (${businessKeySql("tradingName")} IN (${Prisma.join(keys)}) OR ${businessKeySql("legalName")} IN (${Prisma.join(keys)}))`
      : [],
    emailKeys.length
      ? prisma.$queryRaw<{ id: string; key: string }[]>`
          SELECT id, ${EMAIL_KEY_SQL} AS key FROM "Engineer"
          WHERE "deletedAt" IS NULL AND email IS NOT NULL AND ${EMAIL_KEY_SQL} IN (${Prisma.join(emailKeys)})`
      : [],
  ]);
  const emailKeyOf = new Map(sameEmail.map((e) => [e.id, e.key]));
  if (!companyNumbers.length && !postcodes.length && !registrations.length && !named.length && !sameEmail.length) return result;
  const others = await prisma.engineer.findMany({
    where: {
      ...live,
      OR: [
        ...(companyNumbers.length ? [{ companyNumber: { in: companyNumbers } }] : []),
        ...(postcodes.length ? [{ postcode: { in: postcodes } }] : []),
        ...(registrations.length ? [{ gasSafeRegistrationNo: { in: registrations } }, { gasSafeNo: { in: registrations } }] : []),
        ...(named.length || sameEmail.length ? [{ id: { in: [...named.map((n) => n.id), ...sameEmail.map((n) => n.id)] } }] : []),
      ],
    },
    select: { ...ROW_SELECT, leftAt: true },
  });
  const key = (e: { firstName: string | null; lastName: string | null }) => personName(e).toLowerCase();
  for (const row of rows) {
    const rowKeys = new Set(keysOf(row));
    const rowRegistrations = registrationsOf(row);
    const rowEmail = emailOf.get(row.id) ?? null;
    for (const o of others) {
      const sameBusiness = o.id === row.id || o.id === row.ownerId || o.ownerId === row.id || (!!row.ownerId && o.ownerId === row.ownerId);
      if (sameBusiness) continue;
      const businesses = !row.ownerId && !o.ownerId;
      const reason: DuplicateReason | null =
        businesses && row.companyNumber && o.companyNumber === row.companyNumber
          ? "company_number"
          : businesses && rowRegistrations.some((n) => numbersOf(o).registrationNo === n)
            ? "registration_number"
            : businesses && keysOf(o).some((k) => rowKeys.has(k))
              ? "business_name"
              : rowEmail && emailKeyOf.get(o.id) === rowEmail
                ? "email"
                : row.postcode && o.postcode === row.postcode && row.firstName && key(o) === key(row)
                  ? "name_and_postcode"
                  : null;
      if (reason) {
        result.get(row.id)!.push({
          engineerId: o.id,
          reason,
          name: personName(o),
          business: displayName(o),
          status: o.bannedAt ? "banned" : cardCheckPassed(o) && !o.pausedAt && !o.leftAt ? "live" : "not_live",
        });
      }
    }
  }
  return result;
}

async function lastUploads(rows: Row[]): Promise<Map<string, Date>> {
  const ids = rows.map((r) => r.id);
  const uploads = ids.length
    ? await prisma.event.groupBy({ by: ["actorId"], where: { name: "gas_safe_card_added", actorId: { in: ids } }, _max: { ts: true } })
    : [];
  return new Map(uploads.map((u) => [u.actorId!, u._max.ts!]));
}

const later = (a: Date, b: Date | null) => (b && b > a ? b : a);

function waitingSinceOf(r: Row, stage: CheckStage, uploads: Map<string, Date>, now: Date): Date | null {
  if (stage === "card") return later(uploads.get(r.id) ?? r.createdAt, r.gasSafeReopenedAt);
  if (stage === "no_card") return later(r.createdAt, r.gasSafeReopenedAt);
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

const DECIDED_WHERE = {
  ...live,
  OR: [
    { gasSafeVerifiedAt: { not: null }, gasSafeRegisterCheckedAt: { not: null }, ...PASSED_READ },
    { gasSafeVerifiedAt: null, gasSafeRejectedAt: { not: null } },
  ],
} satisfies Prisma.EngineerWhereInput;
const DECIDED_SQL = Prisma.sql`(("gasSafeVerifiedAt" IS NOT NULL AND "gasSafeRegisterCheckedAt" IS NOT NULL AND "gasSafeCardReadId" IS NOT NULL) OR ("gasSafeVerifiedAt" IS NULL AND "gasSafeRejectedAt" IS NOT NULL))`;
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

function searchSql(q: string | undefined) {
  if (!q) return Prisma.empty;
  const like = `%${likeTerm(q)}%`;
  const digits = q.replace(/\D/g, "");
  return Prisma.sql`AND ("firstName" ILIKE ${like} OR "lastName" ILIKE ${like} OR "tradingName" ILIKE ${like} OR "legalName" ILIKE ${like}
    ${digits.length >= 3 ? Prisma.sql`OR "gasSafeNo" LIKE ${`%${digits}%`} OR "gasSafeRegistrationNo" LIKE ${`%${digits}%`} OR "companyNumber" LIKE ${`%${digits}%`}` : Prisma.empty})`;
}

type QueueItem = { row: Row; stage: OpenStage; since: Date };

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
            { gasSafeVerifiedAt: { not: null }, gasSafeCardReadId: null },
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
  const [claims, counts, reads] = await Promise.all([freshClaims(rows.map((r) => r.id)), verificationCounts(wholeQueue), currentReads(rows)]);
  const today = ukDay(now);
  const items = rows.map((r) => {
    const checks = checksOf(r, now);
    const since = waitingSinceOf(r, checks.stage, uploads, now);
    const given = numbersOf(r);
    const typeMismatch = businessTypeMismatch(r);
    const rowWarnings: CaseWarningLite[] = [
      ...((duplicates.get(r.id)?.length ?? 0) > 0 ? [{ code: "duplicate", message: "Possible duplicate of another account." }] : []),
      ...(r.companyStatus && r.companyStatus !== "active" ? [{ code: "company_not_active", message: `The company is ${r.companyStatus} at Companies House.` }] : []),
      ...(typeMismatch ? [{ code: "type_mismatch", message: "The business type doesn't match its name." }] : []),
    ];
    const own = reads.get(r.id);
    const view = cardCheckView({
      hasCard: Boolean(r.gasSafeCardUrl),
      read: own?.read ?? null,
      automaticRead: own?.automatic ?? null,
      live: Boolean(r.gasSafeVerifiedAt),
      passed: cardCheckPassed(r),
      newCard: isNewCard(r, own?.passed ?? null),
      given: { ...given, firstName: r.firstName, lastName: r.lastName },
      warnings: rowWarnings,
      today,
      uploadedAt: uploads.get(r.id) ?? r.createdAt,
      now,
      officersChecked: !(r.businessType === "ltd" || r.companyNumber),
    });
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
      liveSince: cardCheckPassed(r) ? r.gasSafeVerifiedAt!.toISOString() : null,
      standing: r.bannedAt ? ("banned" as const) : r.pausedAt ? ("paused" as const) : null,
      nextRecheck: cardCheckPassed(r) ? dateOnly(nextRegisterCheck(r.gasSafeRegisterCheckedAt, r.gasSafeCardExpiresOn)) : null,
      recheckReason: r.gasSafeRecheckReason,
      decidedAt: decidedAtOf(r)?.toISOString() ?? null,
      rejectReason: r.gasSafeRejectReason,
      claimedBy: claims.get(r.id)?.adminName ?? null,
      /** A chase can go by text: they have a mobile and agreed to texts about finishing setting up. */
      canTextChase: Boolean(r.phone && r.setupTextConsentAt),
      automaticCheck: view.automatic,
      whyHere: view.reasons,
      card: cardOut(view),
      badge: badgeOf(r),
      registerSearch: gasSafeRegisterSearch(searchable(view.details, own?.passed ?? null)),
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

function cardExpiryFar(expiresOn: Date | null, now = new Date()) {
  return Boolean(expiresOn && expiresOn.getTime() > now.getTime() + CARD_EXPIRY_FLAG_DAYS * DAY_MS);
}

const searchable = (d: CardDetails | null, passed: GasSafeCardRead | null) => (d?.licenceNo || d?.registrationNo ? d : detailsOf(passed));

export const isNewCard = (e: { gasSafeCardUrl: string | null } & Pick<CheckFields, "gasSafeVerifiedAt" | "gasSafeCardReadId">, passed: { cardUrl: string } | null) =>
  cardCheckPassed(e) && Boolean(passed && passed.cardUrl !== e.gasSafeCardUrl);

const CHECK_EVENTS: Record<string, "card_passed" | "card_failed" | "register_passed" | "suspended" | "recheck_requested" | "reopened"> = {
  gas_safe_card_check_reopened: "reopened",
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
    const meta = (event.meta ?? {}) as { adminName?: string; reason?: string | null; note?: string | null; cardReadId?: string };
    const kind = CHECK_EVENTS[event.name];
    return {
      kind: kind === "card_passed" && !meta.cardReadId ? ("marked_live" as const) : kind,
      at: event.ts.toISOString(),
      byName: meta.adminName ?? (event.actorType === "SYSTEM" ? ((meta as { automatic?: boolean }).automatic ? "Automatic card check" : "TradeSura team") : null),
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
  const [duplicates, history, officers, claims, profile, search, uploads, reads] = await Promise.all([
    duplicatesFor([row]),
    checkHistory(row.id),
    row.businessType === "ltd" && row.companyNumber ? companyOfficers(row.companyNumber) : Promise.resolve(null),
    freshClaims([row.id]),
    row.companyNumber ? companyProfile(row.companyNumber) : Promise.resolve(null),
    // A name that says it's a company with no company number given: look it up by name.
    nameMismatch === "name_says_company" && !row.companyNumber ? searchCompanies(row.legalName ?? row.tradingName ?? "") : Promise.resolve(null),
    lastUploads([row]),
    currentReads([row]),
  ]);
  const own = reads.get(row.id);
  const read = own?.read ?? null;
  const passed = cardCheckPassed(row);
  const newCard = isNewCard(row, own?.passed ?? null);
  const typeMismatch = businessTypeMismatch(row, profile?.name ?? null);
  const checks = checksOf(row, now);
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
    revision: revisionOf(row),
    standing: standingState(row),
    lock: lockOf(claims.get(row.id)),
    checks: {
      card: checks.card,
      register: checks.register,
      liveSince: passed ? row.gasSafeVerifiedAt!.toISOString() : null,
      registerCheckedAt: passed ? (row.gasSafeRegisterCheckedAt?.toISOString() ?? null) : null,
      nextRecheck: passed ? dateOnly(nextRegisterCheck(row.gasSafeRegisterCheckedAt, row.gasSafeCardExpiresOn)) : null,
      recheckRequested: row.gasSafeRecheckRequestedAt ? { at: row.gasSafeRecheckRequestedAt.toISOString(), reason: row.gasSafeRecheckReason } : null,
      suspended: row.gasSafeSuspendedAt ? { at: row.gasSafeSuspendedAt.toISOString(), reason: row.gasSafeRejectReason } : null,
      failedReason: checks.stage === "card_failed" ? row.gasSafeRejectReason : null,
    },
    history,
    gasSafe: { ...numbersOf(row), registerUrl: GAS_SAFE_REGISTER_URL },
    submitted: { name: personName(row), business: displayName(row), postcode: row.postcode, town: row.town, cardExpiry: dateOnly(row.gasSafeCardExpiresOn) },
    badge: badgeOf(row),
    /** Masked, for admins who may see contact details (the full value comes from the audited reveal). */
    contact: opts.withContact ? { email: maskEmail(row.email), phone: row.phone ? maskPhone(row.phone) : null } : null,
    /** A chase can go by text: they have a mobile and agreed to texts about finishing setting up. */
    canTextChase: Boolean(row.phone && row.setupTextConsentAt),
    customersOnPlans: row.ownerId ? 0 : row._count.plans,
    card: { available: Boolean(row.gasSafeCardUrl), backAvailable: Boolean(row.gasSafeCardUrl && row.gasSafeCardBackUrl), expiresOn: dateOnly(read?.expiresOn ?? null), readId: read?.id ?? null, newCard },
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
  const warnings = caseWarnings(detail, now);
  const view = cardCheckView({
    hasCard: Boolean(row.gasSafeCardUrl),
    read,
    automaticRead: own?.automatic ?? null,
    live: Boolean(row.gasSafeVerifiedAt),
    passed,
    newCard,
    given: { ...numbersOf(row), firstName: row.firstName, lastName: row.lastName },
    warnings,
    today: ukDay(now),
    uploadedAt: uploads.get(row.id) ?? row.createdAt,
    now,
  });
  return {
    ...detail,
    card: { ...detail.card, ...cardOut(view) },
    whyHere: view.reasons,
    registerSearch: gasSafeRegisterSearch(searchable(view.details, own?.passed ?? null)),
    passBlocked: cardPassBlock(view),
    registerBlocked: newCard ? cardPassBlock(view) : null,
    warnings,
  };
}

export type VerificationDetail = NonNullable<Awaited<ReturnType<typeof getVerification>>>;

export type CaseWarning = { code: string; message: string };
type CaseWarningLite = CaseWarning;

const DUPLICATE_WHAT: Record<DuplicateReason, string> = {
  company_number: "company number",
  registration_number: "Gas Safe registration number",
  business_name: "business name",
  email: "email address",
  name_and_postcode: "name and postcode",
};

function duplicateWarning(duplicates: { reason: DuplicateReason }[]): string {
  const what = [...new Set(duplicates.map((d) => DUPLICATE_WHAT[d.reason]))];
  const list = what.length > 1 ? `${what.slice(0, -1).join(", ")} or ${what.at(-1)}` : what[0];
  return `${duplicates.length === 1 ? "Another account shares" : "Other accounts share"} this ${list}.`;
}
const TYPE_MISMATCH_WARNING = {
  name_says_company: "The business name says it's a company, but it was signed up as one that isn't.",
  type_says_company: "It was signed up as a limited company, but the registered name doesn't say Ltd or Limited.",
} as const;

export function cardOut(view: CardCheckView) {
  return { automatic: view.automatic, details: view.details, missing: view.missing, concerns: view.concerns, passedWithoutDetails: view.passedWithoutDetails };
}

const ukDate = (iso: string) => formatUkDate(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));

export function caseWarnings(
  d: {
    duplicates: { reason: DuplicateReason }[];
    card: { available: boolean; expiresOn?: string | null };
    submitted: { cardExpiry: string | null };
    checks: { suspended: { at: string; reason: string | null } | null; card: CardCheck | null };
    businessType?: string | null;
    company: { status: string | null; number?: string | null; officers: { match: NameMatch }[] | null } | null;
    typeMismatch: { kind: "name_says_company" | "type_says_company" } | null;
  },
  now = new Date(),
): CaseWarning[] {
  const w: CaseWarning[] = [];
  if (d.duplicates.length) w.push({ code: "duplicate", message: duplicateWarning(d.duplicates) });
  if (!d.card.available) w.push({ code: "no_card", message: "There's no photo of their Gas Safe ID card." });
  const expiry = d.card.expiresOn ?? d.submitted.cardExpiry;
  if (expiry && expiry < ukDay(now)) w.push({ code: "card_expired", message: `Their Gas Safe ID card expired on ${ukDate(expiry)}.` });
  if (expiry && cardExpiryFar(new Date(`${expiry}T00:00:00Z`), now)) {
    w.push({ code: "card_expiry_far", message: `The card's expiry, ${ukDate(expiry)}, is more than 13 months away. Cards renew yearly.` });
  }
  if (d.checks.suspended && d.checks.card === "waiting") {
    w.push({ code: "was_suspended", message: `Suspended on ${ukDate(d.checks.suspended.at)}${d.checks.suspended.reason ? `: ${d.checks.suspended.reason}` : ""}.` });
  }
  if (d.company?.status && d.company.status !== "active") w.push({ code: "company_not_active", message: `The company is ${d.company.status} at Companies House.` });
  const officers = d.company?.officers;
  if (d.company && d.businessType === "ltd" && d.company.number && officers === null) {
    w.push({ code: "officers_unavailable", message: "Companies House couldn't be asked for the company's officers, so check the applicant is one by hand." });
  }
  if (officers?.length && !officers.some((o) => o.match === "match")) {
    w.push(
      officers.some((o) => o.match === "likely")
        ? { code: "officer_likely", message: "The applicant is only a likely match for a company officer." }
        : { code: "no_officer", message: "No current company officer matches the applicant." },
    );
  }
  if (d.typeMismatch) w.push({ code: "type_mismatch", message: TYPE_MISMATCH_WARNING[d.typeMismatch.kind] });
  return w;
}

/** Whether it went: false with no email on the account, or when email isn't set up here (the dev driver only prints it). Throws if the provider refused it. */
async function emailEngineer(engineerId: string, title: string, paragraphs: string[]): Promise<boolean> {
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { email: true, firstName: true } });
  if (!engineer?.email) return false;
  await sendEmail({ to: engineer.email, ...noticeEmail({ firstName: engineer.firstName, title, paragraphs }) });
  return emailConfigured();
}

type Outcome = "live" | "live_again" | "reopened" | "card_failed" | "suspended" | "badge_on";

async function tellEngineer(engineerId: string, outcome: Outcome, reason: string | null) {
  const why = reason ? ` (${reason})` : "";
  const sends: Record<Outcome, (() => Promise<unknown>)[]> = {
    live: [
      () => sendPushNotification(engineerId, "You're live", "Your Gas Safe card is checked: you can send plan offers now", { url: "/more" }),
      () => notifyEngineer(engineerId, "Your Gas Safe card is checked and you're live on TradeSura: you can send plan offers now. Your Verified Member badge goes on once we've checked you on the Gas Safe Register."),
      async () =>
        (await sendVerifiedEmail(engineerId)) ||
        emailEngineer(engineerId, "You're live on TradeSura", [
          "Good news: we've checked your Gas Safe ID card and your account is live.",
          "You can send plan offers straight away. Your Verified Member badge goes on once we've checked you on the Gas Safe Register.",
        ]),
    ],
    live_again: [
      () => sendPushNotification(engineerId, "You're live again", "Your Gas Safe card is checked: you can send plan offers again", { url: "/more" }),
      () => notifyEngineer(engineerId, "TradeSura: your Gas Safe card is checked and you're live again: you can send plan offers."),
      () => emailEngineer(engineerId, "You're live on TradeSura again", ["We've checked your Gas Safe ID card, so your account is live again and you can send plan offers."]),
    ],
    reopened: [
      () => sendPushNotification(engineerId, "We need your Gas Safe card", "Add a photo of your Gas Safe ID card so we can check it and put you live again", { url: "/more" }),
      () => notifyEngineer(engineerId, "TradeSura: we now check every engineer's Gas Safe ID card before they can send offers. Add a photo of your card in the app and we'll put you live again once it's checked."),
      () =>
        emailEngineer(engineerId, "We need to check your Gas Safe card", [
          "We now check every engineer's Gas Safe ID card before they can send plan offers, and we haven't checked yours yet.",
          "Your plans and customers are unchanged. Open the TradeSura app and add a photo of the front and back of your card: once it's checked you're live again.",
        ]),
    ],
    badge_on: [
      () => sendPushNotification(engineerId, "Your badge is on", "You're checked on the Gas Safe Register: your Verified Member badge is on", { url: "/more" }),
      () =>
        emailEngineer(engineerId, "Your Verified Member badge is on", [
          "We've checked you on the Gas Safe Register, so your Verified Member badge now shows to customers on your plans and pages.",
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

export async function tellReopened(engineerId: string) {
  await tellEngineer(engineerId, "reopened", null);
  await prisma.event.create({ data: { name: "gas_safe_card_check_reopen_told", actorType: "SYSTEM", meta: { engineerId } } });
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

async function nextInStage(engineerId: string, stage: CheckStage) {
  if (!isOpen(stage)) return null;
  return (await openQueue()).items.find((i) => i.stage === stage && i.row.id !== engineerId)?.row.id ?? null;
}

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

function numbersAgree(row: { gasSafeNo: string | null; gasSafeRegistrationNo: string | null }, read: GasSafeCardRead) {
  const own = gasSafeNumbers(row);
  return Boolean(own.licenceNo || own.registrationNo) && (!own.licenceNo || own.licenceNo === read.licenceNo) && (!own.registrationNo || own.registrationNo === read.registrationNo);
}

function cardData(row: { gasSafeRegistrationNo: string | null }, read: GasSafeCardRead) {
  return {
    gasSafeCardReadId: read.id,
    gasSafeCardExpiresOn: read.expiresOn,
    ...(read.registrationNo && read.registrationNo !== row.gasSafeRegistrationNo ? { gasSafeRegistrationNo: read.registrationNo } : {}),
  };
}

const REOPEN_CLEARED = { gasSafeReopenedAt: null, gasSafeVerifiedBeforeReopenAt: null, gasSafeRegisterCheckedBeforeReopenAt: null } as const;

function passData(
  row: {
    gasSafeVerifiedAt: Date | null;
    gasSafeNo: string | null;
    gasSafeRegistrationNo: string | null;
    gasSafeRegisterCheckedAt: Date | null;
    gasSafeVerifiedBeforeReopenAt: Date | null;
    gasSafeRegisterCheckedBeforeReopenAt: Date | null;
  },
  read: GasSafeCardRead,
  now: Date,
) {
  const keepRegister = Boolean(row.gasSafeVerifiedAt && row.gasSafeRegisterCheckedAt && numbersAgree(row, read));
  const restoreRegister = Boolean(!row.gasSafeVerifiedAt && row.gasSafeVerifiedBeforeReopenAt && row.gasSafeRegisterCheckedBeforeReopenAt && numbersAgree(row, read));
  return {
    gasSafeVerifiedAt: row.gasSafeVerifiedAt ?? row.gasSafeVerifiedBeforeReopenAt ?? now,
    gasSafeRejectedAt: null,
    gasSafeRejectReason: null,
    gasSafeSuspendedAt: null,
    ...(keepRegister
      ? {}
      : restoreRegister
        ? { gasSafeRegisterCheckedAt: row.gasSafeRegisterCheckedBeforeReopenAt, gasSafeRecheckRequestedAt: null, gasSafeRecheckReason: null }
        : { gasSafeRegisterCheckedAt: null, gasSafeRecheckRequestedAt: null, gasSafeRecheckReason: null }),
    ...REOPEN_CLEARED,
    ...cardData(row, read),
  };
}

const liveAgain = (row: { gasSafeVerifiedAt: Date | null; gasSafeVerifiedBeforeReopenAt: Date | null }) => !row.gasSafeVerifiedAt && Boolean(row.gasSafeVerifiedBeforeReopenAt);

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
  const current = approved ? await getVerification(engineerId) : null;
  const deciding = current && (current.stage === "card" || current.stage === "no_card") && (!input.revision || current.revision === input.revision);
  if (deciding && current.passBlocked) throw conflict(current.passBlocked);
  const concerns = current?.stage === "card" ? current.card.concerns : [];
  const readId = current?.card.readId ?? null;
  if (input.duplicateOf && !(await prisma.engineer.count({ where: { id: input.duplicateOf, NOT: { id: engineerId } } }))) {
    throw notFound("The account it duplicates doesn't exist.");
  }
  const now = new Date();
  const { stage, wasLive, again } = await checkStep(
    admin,
    engineerId,
    input.revision,
    ["card", "no_card"],
    "This application has already been decided.",
    async (tx, row, stage) => {
      if (!row.gasSafeNo && !row.gasSafeVerifiedAt) throw conflict("This engineer hasn't submitted a Gas Safe number yet.");
      if (approved && stage === "no_card") throw conflict("There's no card photo to check yet. Chase them for it.");
      if (approved && concerns.length && !reason) {
        throw new AdminApiError(400, "VALIDATION", "Say why you're passing it with open warnings.", { reason: ["Say why you're passing it with open warnings."] });
      }
      if (approved) {
        const read = readId ? await tx.gasSafeCardRead.findUnique({ where: { id: readId } }) : null;
        if (!read || !read.complete || read.cardUrl !== row.gasSafeCardUrl) throw conflict("The card changed while you had it open. Reload to see the latest before deciding.");
        await tx.engineer.update({ where: { id: engineerId }, data: passData(row, read, now) });
      } else {
        await tx.engineer.update({
          where: { id: engineerId },
          data: { gasSafeVerifiedAt: null, gasSafeCardReadId: null, gasSafeRegisterCheckedAt: null, gasSafeRecheckRequestedAt: null, gasSafeRecheckReason: null, gasSafeRejectedAt: now, gasSafeRejectReason: reason, ...REOPEN_CLEARED },
        });
      }
      await adminEvent(
        admin,
        approved ? "gas_safe_verified" : "gas_safe_rejected",
        {
          engineerId,
          reason,
          before: stage,
          ...(row.gasSafeVerifiedAt ? { wasLive: true } : {}),
          ...(approved && readId ? { cardReadId: readId } : {}),
          ...(input.duplicateOf ? { duplicateOf: input.duplicateOf } : {}),
          ...(concerns.length ? { warnings: (current?.warnings ?? []).filter((w) => w.code !== "no_card").map((w) => w.code), concerns } : {}),
        },
        tx,
      );
      return { stage, wasLive: Boolean(row.gasSafeVerifiedAt), again: liveAgain(row) };
    },
  );
  if (!(approved && wasLive)) await afterResponse(() => tellEngineer(engineerId, approved ? (again ? "live_again" : "live") : "card_failed", reason));
  return { id: engineerId, outcome: approved ? ("verified" as const) : ("rejected" as const), decidedAt: now.toISOString(), nextId: await nextInStage(engineerId, stage) };
}

export async function passRegisterCheck(admin: AdminPrincipal, engineerId: string, input: { note: string; revision?: string }) {
  const now = new Date();
  const current = await getVerification(engineerId);
  const sameView = current && (!input.revision || current.revision === input.revision);
  if (sameView && current.card.newCard && current.registerBlocked) throw conflict(current.registerBlocked);
  const readId = current?.card.newCard ? current.card.readId : null;
  const stage = await checkStep(admin, engineerId, input.revision, ["register", "recheck"], "Their register check isn't due.", async (tx, row, stage) => {
    const passed = row.gasSafeCardReadId ? await tx.gasSafeCardRead.findUnique({ where: { id: row.gasSafeCardReadId }, select: { cardUrl: true } }) : null;
    let newRead: GasSafeCardRead | null = null;
    if (!passed || passed.cardUrl !== row.gasSafeCardUrl) {
      newRead = readId ? await tx.gasSafeCardRead.findUnique({ where: { id: readId } }) : null;
      if (!newRead || !newRead.complete || newRead.cardUrl !== row.gasSafeCardUrl) {
        throw conflict("Their new card hasn't been read in full. Enter its details from the photo before passing the register check.");
      }
    }
    await tx.engineer.update({
      where: { id: engineerId },
      data: { gasSafeRegisterCheckedAt: now, gasSafeRecheckRequestedAt: null, gasSafeRecheckReason: null, ...(newRead ? cardData(row, newRead) : {}) },
    });
    await adminEvent(admin, "gas_safe_register_checked", { engineerId, note: input.note, recheck: stage === "recheck", ...(newRead ? { cardReadId: newRead.id, newCard: true } : {}) }, tx);
    return stage;
  });
  if (stage === "register") await afterResponse(() => tellEngineer(engineerId, "badge_on", null));
  return { id: engineerId, checkedAt: now.toISOString(), nextId: await nextInStage(engineerId, stage) };
}

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
  if (isPrivateCardUrl(url)) return true;
  if (url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com")) return true;
  const extra = (process.env.ADMIN_CARD_EXTRA_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return extra.includes(url.origin);
}

async function cardImage(stored: string, engineerId: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  let url: URL;
  try {
    url = new URL(stored);
  } catch {
    return null;
  }
  if (!cardSourceAllowed(url)) {
    console.error(`[admin-api] card for ${engineerId} isn't on an allowed host: ${url.host}`);
    return null;
  }
  if (isPrivateCardUrl(url)) {
    const card = await readPrivateCard(url.href);
    if (!card || !CARD_TYPES.has(card.type) || card.bytes.byteLength > MAX_CARD_BYTES) return null;
    return card;
  }
  const res = await fetch(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !(CARD_TYPES.has(type) || (type === "image/svg+xml" && !url.hostname.endsWith(".vercel-storage.com")))) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_CARD_BYTES) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_CARD_BYTES) return null;
  return { bytes, type };
}

export async function fetchCard(engineerId: string, side: "front" | "back" = "front"): Promise<Response | null> {
  const row = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { gasSafeCardUrl: true, gasSafeCardBackUrl: true } });
  const stored = side === "back" ? (row?.gasSafeCardUrl ? row.gasSafeCardBackUrl : null) : row?.gasSafeCardUrl;
  if (!stored) return null;
  const image = await cardImage(stored, engineerId);
  if (!image) return null;
  const { bytes: body, type } = image;
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

const SYSTEM_CHECK = { id: "system:card-check", name: "Automatic card check" } as const;

const asImage = (i: { bytes: ArrayBuffer; type: string } | null): CardImage | null => (i ? { bytes: new Uint8Array(i.bytes), mediaType: i.type } : null);

async function saveRead(engineerId: string, cardUrl: string, backUrl: string | null, reading: CardReading, by: { source: "automatic" | "checker"; id?: string; name?: string }) {
  return prisma.gasSafeCardRead.create({
    data: {
      engineerId,
      cardUrl,
      backUrl,
      source: by.source,
      outcome: reading.outcome,
      complete: readComplete(reading),
      isGasSafeCard: reading.isGasSafeCard,
      suspect: reading.suspect,
      licenceNo: reading.licenceNo,
      registrationNo: reading.registrationNo,
      name: reading.name,
      company: reading.company,
      expiresOn: reading.expiresOn ? new Date(`${reading.expiresOn}T00:00:00Z`) : null,
      categories: reading.categories,
      notes: reading.notes,
      model: reading.model,
      readById: by.id ?? null,
      readByName: by.name ?? null,
    },
  });
}

async function readFromPhotos(engineerId: string, cardUrl: string, backUrl: string | null): Promise<CardReading> {
  const [front, back] = await Promise.all([cardImage(cardUrl, engineerId).catch(() => null), backUrl ? cardImage(backUrl, engineerId).catch(() => null) : null]);
  const frontImage = asImage(front);
  if (!frontImage) return { outcome: "unreadable", isGasSafeCard: null, suspect: false, licenceNo: null, registrationNo: null, name: null, company: null, expiresOn: null, categories: [], notes: ["The card photo couldn't be opened."], model: null };
  return readGasSafeCard(frontImage, asImage(back));
}

export async function runCardCheck(engineerId: string, opts: { force?: boolean } = {}): Promise<GasSafeCardRead | null> {
  const e = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { gasSafeCardUrl: true, gasSafeCardBackUrl: true } });
  if (!e?.gasSafeCardUrl) return null;
  if (!opts.force) {
    const existing = await prisma.gasSafeCardRead.findFirst({ where: { engineerId, cardUrl: e.gasSafeCardUrl, backUrl: e.gasSafeCardBackUrl, source: "automatic" }, orderBy: { createdAt: "desc" } });
    if (existing && existing.outcome !== "error" && existing.outcome !== "not_set_up") return existing;
  }
  const reading = cardReadConfigured() ? await readFromPhotos(engineerId, e.gasSafeCardUrl, e.gasSafeCardBackUrl) : notSetUpReading();
  const saved = await saveRead(engineerId, e.gasSafeCardUrl, e.gasSafeCardBackUrl, reading, { source: "automatic" });
  if (saved.complete) await passAutomatically(engineerId, saved.id);
  return saved;
}

async function passCleanCard(engineerId: string, readId: string | null, by: { automatic: boolean; name: string; via?: string }): Promise<boolean> {
  const detail = await getVerification(engineerId);
  if (!detail || detail.stage !== "card" || detail.lock) return false;
  const id = readId ?? detail.card.readId;
  if (!id || detail.card.readId !== id || detail.card.concerns.length || detail.passBlocked) return false;
  if (by.automatic && detail.card.automatic !== "passed") return false;
  const now = new Date();
  const passed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Engineer" WHERE id = ${engineerId} FOR UPDATE`;
    const row = await tx.engineer.findFirst({ where: { id: engineerId, ...live }, select: { ...CHECK_SELECT, ...REVISION_SELECT } });
    if (!row || stageOf(row, now) !== "card" || row.pausedAt || row.bannedAt || revisionOf(row) !== detail.revision) return null;
    const read = await tx.gasSafeCardRead.findUnique({ where: { id } });
    if (!read?.complete || read.cardUrl !== row.gasSafeCardUrl) return null;
    const wasLive = Boolean(row.gasSafeVerifiedAt);
    const again = liveAgain(row);
    await tx.engineer.update({ where: { id: engineerId }, data: passData(row, read, now) });
    await tx.event.create({
      data: {
        name: "gas_safe_verified",
        actorType: "SYSTEM",
        meta: { engineerId, automatic: by.automatic, cardReadId: id, before: "card", adminName: by.name, ...(by.via ? { via: by.via } : {}), ...(wasLive ? { wasLive: true } : {}) },
      },
    });
    return { wasLive, again };
  });
  if (passed && !passed.wasLive) await afterResponse(() => tellEngineer(engineerId, passed.again ? "live_again" : "live", null));
  return Boolean(passed);
}

const passAutomatically = (engineerId: string, readId: string) => (autoPassOn() ? passCleanCard(engineerId, readId, { automatic: true, name: SYSTEM_CHECK.name }) : Promise.resolve(false));

export const CARD_READ_TRIES = 3;
const RETRIES_PER_RUN = 5;

export async function retryCardReads(now = new Date()): Promise<number> {
  if (!cardReadConfigured()) return 0;
  const rows = await prisma.engineer.findMany({
    where: { ...live, gasSafeCardUrl: { not: null }, gasSafeRejectedAt: null },
    select: { id: true, gasSafeCardUrl: true, gasSafeCardReadId: true },
  });
  const reads = await currentReads(rows);
  const unread = rows.filter((r) => !reads.get(r.id)?.read?.complete && !reads.get(r.id)?.automatic);
  const failed = rows.filter((r) => {
    const a = reads.get(r.id)?.automatic;
    return !reads.get(r.id)?.read?.complete && a && (a.outcome === "error" || a.outcome === "not_set_up") && now.getTime() - a.createdAt.getTime() > 20 * 3_600_000;
  });
  const due: string[] = [];
  for (const r of [...unread, ...failed]) {
    if (due.length >= RETRIES_PER_RUN) break;
    const tries = await prisma.gasSafeCardRead.count({ where: { engineerId: r.id, cardUrl: r.gasSafeCardUrl!, source: "automatic", outcome: { in: ["error", "not_set_up"] } } });
    if (tries < CARD_READ_TRIES) due.push(r.id);
  }
  await Promise.all(due.map((id) => runCardCheck(id, { force: true }).catch((err) => console.error(`[card-check] retry for ${id} failed:`, err))));
  return due.length;
}

export function queueCardCheck(engineerId: string) {
  return afterResponse(async () => {
    try {
      await runCardCheck(engineerId);
    } catch (err) {
      console.error(`[card-check] ${engineerId} failed:`, err);
    }
  });
}

export async function readCardAgain(admin: AdminPrincipal, engineerId: string) {
  const row = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { gasSafeCardUrl: true } });
  if (!row) throw notFound("There's no engineer with that ID.");
  if (!row.gasSafeCardUrl) throw conflict("There's no card photo to read yet.");
  if (!cardReadConfigured()) throw conflict("The automatic card check isn't set up on this server, so the card can't be read again. Enter the details from the photo instead.");
  const read = await runCardCheck(engineerId, { force: true });
  await adminEvent(admin, "gas_safe_card_read_again", { engineerId, cardReadId: read?.id ?? null, outcome: read?.outcome ?? null });
  return { id: engineerId, outcome: read?.outcome ?? null, complete: read?.complete ?? false };
}

export async function saveCardDetails(
  admin: AdminPrincipal,
  engineerId: string,
  input: { licenceNo: string; registrationNo: string; name: string; expiresOn: string; categories: string[]; revision?: string },
) {
  const row = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { gasSafeCardBackUrl: true, ...REVISION_SELECT } });
  if (!row) throw notFound("There's no engineer with that ID.");
  if (!row.gasSafeCardUrl) throw conflict("There's no card photo to read details from yet.");
  if (input.revision && revisionOf(row) !== input.revision) throw conflict("This case changed while you had it open. Reload to see the latest before saving.");
  const latest = (await currentReads([{ id: engineerId, gasSafeCardUrl: row.gasSafeCardUrl, gasSafeCardReadId: null }])).get(engineerId)?.read ?? null;
  const reading: CardReading = {
    outcome: "read",
    isGasSafeCard: true,
    suspect: false,
    licenceNo: input.licenceNo,
    registrationNo: input.registrationNo,
    name: input.name.trim(),
    company: latest?.company ?? null,
    expiresOn: input.expiresOn,
    categories: row.gasSafeCardBackUrl ? input.categories.map((c) => c.trim()).filter(Boolean) : [],
    notes: [],
    model: null,
  };
  const saved = await saveRead(engineerId, row.gasSafeCardUrl, row.gasSafeCardBackUrl, reading, { source: "checker", id: admin.id, name: admin.name });
  await adminEvent(admin, "gas_safe_card_details_entered", {
    engineerId,
    cardReadId: saved.id,
    changed: latest
      ? (["licenceNo", "registrationNo", "name", "expiresOn"] as const).filter((k) => String((k === "expiresOn" ? dateOnly(latest.expiresOn) : latest[k]) ?? "") !== String(input[k] ?? ""))
      : ["licenceNo", "registrationNo", "name", "expiresOn"],
  });
  return { id: engineerId, cardReadId: saved.id };
}
