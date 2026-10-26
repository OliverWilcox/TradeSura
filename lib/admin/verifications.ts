import { createHash } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { CLAUSE_TEMPLATES } from "@/lib/clauses";
import { confirmedQualifications } from "@/lib/plan-rules";
import { companyOfficers, officerMatches } from "@/lib/companies-house";
import { displayName } from "@/lib/engineer";
import { notifyEngineer } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { sendPushNotification } from "@/lib/push";
import { standingState } from "@/lib/verification-state";
import { adminEvent } from "@/lib/admin-api/audit";
import { likeTerm } from "@/lib/admin-api/db";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";

// The Gas Safe verification queue for the admin API: the same queue, rules
// and messages as app/admin/verifications (29 Sept review — verification is
// a human decision), with who decided recorded against the decision. The
// queue shows only what the check needs: no contact details, because
// verification checkers see it too.

/**
 * pending is everything waiting; new and duplicates split it by whether
 * another account shares details. decided is verified and rejected together,
 * most recent decision first.
 */
export type VerificationTab = "new" | "duplicates" | "pending" | "verified" | "rejected" | "decided";

const live = { deletedAt: null } satisfies Prisma.EngineerWhereInput;

const TAB_WHERE: Record<"pending" | "verified" | "rejected" | "decided", Prisma.EngineerWhereInput> = {
  pending: { ...live, gasSafeNo: { not: null }, gasSafeVerifiedAt: null, gasSafeRejectedAt: null },
  verified: { ...live, gasSafeVerifiedAt: { not: null } },
  rejected: { ...live, gasSafeVerifiedAt: null, gasSafeRejectedAt: { not: null } },
  decided: { ...live, OR: [{ gasSafeVerifiedAt: { not: null } }, { gasSafeRejectedAt: { not: null } }] },
};

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

const ROW_SELECT = {
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
  gasSafeNo: true,
  gasSafeCardUrl: true,
  gasSafeReviewRequestedAt: true,
  gasSafeVerifiedAt: true,
  gasSafeRejectedAt: true,
  gasSafeRejectReason: true,
  qualificationConfirmations: true,
  ownerId: true,
  createdAt: true,
} satisfies Prisma.EngineerSelect;

type Row = Prisma.EngineerGetPayload<{ select: typeof ROW_SELECT }>;

/** What the checker looked at. If any of it changes, a decision made on the old view is refused. */
const REVISION_SELECT = {
  gasSafeNo: true,
  gasSafeCardUrl: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  businessType: true,
  companyNumber: true,
  gasSafeVerifiedAt: true,
  gasSafeRejectedAt: true,
} satisfies Prisma.EngineerSelect;

export function revisionOf(e: Prisma.EngineerGetPayload<{ select: typeof REVISION_SELECT }>): string {
  const parts = [e.gasSafeNo, e.gasSafeCardUrl, e.firstName, e.lastName, e.tradingName, e.legalName, e.businessType, e.companyNumber, e.gasSafeVerifiedAt?.toISOString(), e.gasSafeRejectedAt?.toISOString()];
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

const nameWords = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, " ").trim().split(" ").filter(Boolean);

/**
 * The register says "D. Smith": a match is the same surname and first initial.
 * Both sides are normalised alike, so "Armstrong-Medhurst" and "O'Brien" match themselves.
 */
export function registerNameMatches(registerName: string, firstName: string | null, lastName: string | null) {
  if (!firstName?.trim() || !lastName?.trim()) return false;
  const register = nameWords(registerName);
  const surname = nameWords(lastName);
  if (register.length <= surname.length) return false;
  const tail = register.slice(-surname.length);
  return tail.every((w, i) => w === surname[i]) && register[0][0] === nameWords(firstName)[0]?.[0];
}

type DuplicateReason = "company_number" | "name_and_postcode";
export type Duplicate = { engineerId: string; reason: DuplicateReason; name: string; business: string; status: string };

/** Other accounts that look like the same business or person. A signal for the checker, never a decision. */
async function duplicatesFor(rows: Row[]): Promise<Map<string, Duplicate[]>> {
  const result = new Map<string, Duplicate[]>(rows.map((r) => [r.id, []]));
  const companyNumbers = [...new Set(rows.map((r) => r.companyNumber).filter((n): n is string => !!n))];
  const postcodes = [...new Set(rows.map((r) => r.postcode).filter((p): p is string => !!p))];
  if (!companyNumbers.length && !postcodes.length) return result;
  const others = await prisma.engineer.findMany({
    where: {
      ...live,
      OR: [
        ...(companyNumbers.length ? [{ companyNumber: { in: companyNumbers } }] : []),
        ...(postcodes.length ? [{ postcode: { in: postcodes } }] : []),
      ],
    },
    select: { ...ROW_SELECT, bannedAt: true },
  });
  const key = (e: { firstName: string | null; lastName: string | null }) => personName(e).toLowerCase();
  for (const row of rows) {
    for (const o of others) {
      if (o.id === row.id || o.id === row.ownerId || o.ownerId === row.id) continue;
      const reason: DuplicateReason | null =
        row.companyNumber && o.companyNumber === row.companyNumber
          ? "company_number"
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

async function registerRecords(rows: Row[]) {
  const regNos = [...new Set(rows.map((r) => r.gasSafeNo).filter((n): n is string => !!n))];
  const records = regNos.length ? await prisma.gasSafeRecord.findMany({ where: { regNo: { in: regNos } } }) : [];
  return new Map(records.map((r) => [r.regNo, r]));
}

function registerCheck(row: Row, records: Map<string, { name: string; company: string; categories: string }>) {
  const record = row.gasSafeNo ? records.get(row.gasSafeNo) : undefined;
  if (!record) return { result: "not_found" as const, record: null };
  return {
    result: registerNameMatches(record.name, row.firstName, row.lastName) ? ("match" as const) : ("name_mismatch" as const),
    record: { name: record.name, company: record.company, categories: record.categories },
  };
}

/** The business name as displayName() shows it, for sorting in SQL. */
const BUSINESS_SQL = Prisma.sql`lower(COALESCE(NULLIF(trim("tradingName"), ''), NULLIF(trim("legalName"), ''), slug))`;

const DECIDED_SQL: Record<"verified" | "rejected" | "decided", Prisma.Sql> = {
  verified: Prisma.sql`"gasSafeVerifiedAt" IS NOT NULL`,
  rejected: Prisma.sql`"gasSafeVerifiedAt" IS NULL AND "gasSafeRejectedAt" IS NOT NULL`,
  decided: Prisma.sql`("gasSafeVerifiedAt" IS NOT NULL OR "gasSafeRejectedAt" IS NOT NULL)`,
};

function orderFor(tab: "pending" | "verified" | "rejected", sort: string | undefined, dir: "asc" | "desc" | undefined): Prisma.EngineerOrderByWithRelationInput[] {
  if (sort === "name") return [{ lastName: dir ?? "asc" }, { firstName: dir ?? "asc" }, { id: "asc" }];
  if (sort === "decided" && tab !== "pending") {
    return [tab === "verified" ? { gasSafeVerifiedAt: dir ?? "desc" } : { gasSafeRejectedAt: dir ?? "desc" }, { id: "asc" }];
  }
  // Oldest first while waiting; most recent decision first once decided.
  if (tab === "pending") return [{ createdAt: dir ?? "asc" }, { id: "asc" }];
  return [tab === "verified" ? { gasSafeVerifiedAt: "desc" } : { gasSafeRejectedAt: "desc" }, { id: "asc" }];
}

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
      ...(digits.length >= 3 ? [{ gasSafeNo: { contains: digits } }, { companyNumber: { contains: digits } }] : []),
    ],
  };
}

/** The same search, for the one raw query (decided, ordered by whichever decision date is set). */
function searchSql(q: string | undefined) {
  if (!q) return Prisma.empty;
  const like = `%${likeTerm(q)}%`;
  const digits = q.replace(/\D/g, "");
  return Prisma.sql`AND ("firstName" ILIKE ${like} OR "lastName" ILIKE ${like} OR "tradingName" ILIKE ${like} OR "legalName" ILIKE ${like}
    ${digits.length >= 3 ? Prisma.sql`OR "gasSafeNo" LIKE ${`%${digits}%`} OR "companyNumber" LIKE ${`%${digits}%`}` : Prisma.empty})`;
}

/** Everything waiting, oldest first, with each one's duplicate signals. The queue is short, so it's loaded whole. */
async function waitingQueue(q?: string, sort?: string, dir?: "asc" | "desc") {
  const rows = await prisma.engineer.findMany({ where: { AND: [TAB_WHERE.pending, searchWhere(q)] }, orderBy: orderFor("pending", sort, dir), select: ROW_SELECT });
  return { rows, duplicates: await duplicatesFor(rows) };
}

/** Counts per tab. Pass the whole waiting queue if it's already loaded (unsearched), so it isn't loaded twice. */
export async function verificationCounts(loaded?: Awaited<ReturnType<typeof waitingQueue>>) {
  const [queue, verified, rejected] = await Promise.all([
    loaded ?? waitingQueue(),
    prisma.engineer.count({ where: TAB_WHERE.verified }),
    prisma.engineer.count({ where: TAB_WHERE.rejected }),
  ]);
  const flagged = queue.rows.filter((r) => queue.duplicates.get(r.id)!.length > 0).length;
  return { new: queue.rows.length - flagged, duplicates: flagged, pending: queue.rows.length, verified, rejected, decided: verified + rejected };
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
  let rows: Row[];
  let total: number;
  let duplicates: Map<string, Duplicate[]>;
  let wholeQueue: Awaited<ReturnType<typeof waitingQueue>> | undefined;
  if (q.tab === "new" || q.tab === "duplicates" || q.tab === "pending") {
    const queue = await waitingQueue(q.q, q.sort, q.dir);
    if (!q.q) wholeQueue = queue;
    let inTab = q.tab === "pending" ? queue.rows : queue.rows.filter((r) => queue.duplicates.get(r.id)!.length > 0 === (q.tab === "duplicates"));
    if (q.sort === "business") {
      const sign = q.dir === "desc" ? -1 : 1;
      inTab = [...inTab].sort((a, b) => sign * displayName(a).localeCompare(displayName(b), "en-GB", { sensitivity: "base" }) || a.id.localeCompare(b.id));
    }
    rows = inTab.slice(skip, skip + q.size);
    total = inTab.length;
    duplicates = queue.duplicates;
  } else if (q.sort === "business" || (q.tab === "decided" && q.sort !== "name")) {
    // Orders Prisma can't express: by whichever decision date is set, or by the business name as shown.
    const dir = q.dir === "asc" || (q.sort === "business" && !q.dir) ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const order = q.sort === "business" ? BUSINESS_SQL : Prisma.sql`COALESCE("gasSafeVerifiedAt", "gasSafeRejectedAt")`;
    const ids = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Engineer"
      WHERE "deletedAt" IS NULL AND ${DECIDED_SQL[q.tab]} ${searchSql(q.q)}
      ORDER BY ${order} ${dir}, id
      LIMIT ${q.size} OFFSET ${skip}`;
    const found = await prisma.engineer.findMany({ where: { id: { in: ids.map((i) => i.id) } }, select: ROW_SELECT });
    const byId = new Map(found.map((r) => [r.id, r]));
    rows = ids.map((i) => byId.get(i.id)!).filter(Boolean);
    total = await prisma.engineer.count({ where: { AND: [TAB_WHERE[q.tab], searchWhere(q.q)] } });
    duplicates = await duplicatesFor(rows);
  } else {
    const stored = q.tab === "decided" ? "verified" : q.tab;
    const where = { AND: [q.tab === "decided" ? TAB_WHERE.decided : TAB_WHERE[q.tab], searchWhere(q.q)] };
    [rows, total] = await Promise.all([
      prisma.engineer.findMany({ where, orderBy: orderFor(stored, q.sort, q.dir), skip, take: q.size, select: ROW_SELECT }),
      prisma.engineer.count({ where }),
    ]);
    duplicates = await duplicatesFor(rows);
  }
  const [records, claims, counts] = await Promise.all([registerRecords(rows), freshClaims(rows.map((r) => r.id)), verificationCounts(wholeQueue)]);
  const items = rows.map((r) => ({
    id: r.id,
    name: personName(r),
    business: displayName(r),
    businessType: r.businessType,
    gasSafeNo: r.gasSafeNo,
    submittedAt: r.createdAt.toISOString(),
    status: verificationStatus(r),
    decidedAt: (r.gasSafeVerifiedAt ?? r.gasSafeRejectedAt)?.toISOString() ?? null,
    rejectReason: r.gasSafeRejectReason,
    claimedBy: claims.get(r.id)?.adminName ?? null,
    signals: {
      hasCard: Boolean(r.gasSafeCardUrl),
      register: registerCheck(r, records).result,
      companyNotActive: Boolean(r.companyStatus && r.companyStatus !== "active"),
      duplicates: duplicates.get(r.id)?.length ?? 0,
      registerMismatchAtSignup: Boolean(r.gasSafeReviewRequestedAt),
    },
  }));
  return { items, page: q.page, size: q.size, total, counts };
}

async function lastDecision(engineerId: string) {
  const event = await prisma.event.findFirst({
    where: { name: { in: ["gas_safe_verified", "gas_safe_rejected"] }, meta: { path: ["engineerId"], equals: engineerId } },
    orderBy: { ts: "desc" },
  });
  if (!event) return null;
  const meta = (event.meta ?? {}) as { adminName?: string; reason?: string | null; via?: string };
  return {
    outcome: event.name === "gas_safe_verified" ? ("verified" as const) : ("rejected" as const),
    at: event.ts.toISOString(),
    byName: meta.adminName ?? (event.actorType === "SYSTEM" ? "TradeSura team" : null),
    reason: meta.reason ?? null,
  };
}

export async function getVerification(engineerId: string) {
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
      ...REVISION_SELECT,
      owner: { select: { id: true, tradingName: true, legalName: true, slug: true } },
    },
  });
  if (!row) return null;
  const [duplicates, records, decision, officers, claims] = await Promise.all([
    duplicatesFor([row]),
    registerRecords([row]),
    lastDecision(row.id),
    row.businessType === "ltd" && row.companyNumber ? companyOfficers(row.companyNumber) : Promise.resolve(null),
    freshClaims([row.id]),
  ]);
  const status = verificationStatus(row);
  // Where it sits among the applications in the same tab (new or flagged duplicates).
  let tab: "new" | "duplicates" | "verified" | "rejected" | null = status === "verified" || status === "rejected" ? status : null;
  let queue = null;
  if (status === "pending") {
    const waiting = await waitingQueue();
    const flagged = (id: string) => waiting.duplicates.get(id)!.length > 0;
    const mine = flagged(row.id);
    tab = mine ? "duplicates" : "new";
    const ids = waiting.rows.filter((r) => flagged(r.id) === mine).map((r) => r.id);
    const at = ids.indexOf(row.id);
    queue = { position: at + 1, total: ids.length, previousId: ids[at - 1] ?? null, nextId: ids[at + 1] ?? null };
  }
  const register = registerCheck(row, records);
  return {
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
    status,
    tab,
    /** Send back with a decision: if the application changes in the meantime, the decision is refused. */
    revision: revisionOf(row),
    standing: standingState(row),
    lock: lockOf(claims.get(row.id)),
    gasSafe: {
      number: row.gasSafeNo,
      register: register.result,
      onRegister: register.record,
      mismatchAtSignup: Boolean(row.gasSafeReviewRequestedAt),
      registerUrl: "https://www.gassaferegister.co.uk/",
    },
    card: { available: Boolean(row.gasSafeCardUrl) },
    company:
      row.businessType === "ltd" || row.companyNumber
        ? {
            name: row.legalName ?? row.tradingName,
            number: row.companyNumber,
            status: row.companyStatus,
            officers: officers?.map((o) => ({ ...o, matchesApplicant: officerMatches(o.name, row.firstName, row.lastName) })) ?? null,
          }
        : null,
    qualifications: Object.entries(confirmedQualifications(row.qualificationConfirmations)).map(([code, at]) => ({
      code,
      title: CLAUSE_TEMPLATES.find((c) => c.code === code)?.title ?? code,
      confirmedAt: at,
    })),
    duplicates: duplicates.get(row.id)!,
    decision: decision ?? (status === "verified" || status === "rejected" ? { outcome: status, at: (row.gasSafeVerifiedAt ?? row.gasSafeRejectedAt)!.toISOString(), byName: null, reason: row.gasSafeRejectReason } : null),
    queue,
  };
}

export type VerificationDetail = NonNullable<Awaited<ReturnType<typeof getVerification>>>;

// --- Deciding ---------------------------------------------------------------

async function emailEngineer(engineerId: string, subject: string, html: string) {
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { email: true, firstName: true } });
  if (!engineer?.email) return;
  await sendEmail({ to: engineer.email, subject, html: `<p>Hi ${escapeHtml(engineer.firstName ?? "there")},</p>${html}` });
}

/** Push, text and email, as app/admin/verifications sends them. A failed send never undoes the decision. */
async function tellEngineer(engineerId: string, approved: boolean, reason: string | null) {
  const sends = approved
    ? [
        () => sendPushNotification(engineerId, "You're verified", "You're Gas Safe verified — your member pack is on its way", { url: "/more" }),
        () => notifyEngineer(engineerId, "You're Gas Safe verified on TradeSura — your member pack is on its way."),
        () =>
          emailEngineer(
            engineerId,
            "You're Gas Safe verified on TradeSura",
            "<p>Good news — we've checked your Gas Safe registration and your Verified badge is now live. You can send plan offers straight away, and your member pack is on its way.</p>",
          ),
      ]
    : [
        () => notifyEngineer(engineerId, "We couldn't verify your Gas Safe number on TradeSura — open the app to check it and try again."),
        () =>
          emailEngineer(
            engineerId,
            "We couldn't verify your Gas Safe registration",
            `<p>We weren't able to verify your Gas Safe registration${reason ? ` (${escapeHtml(reason)})` : ""}. Open the TradeSura app to check your number and ID card, then submit it again.</p>`,
          ),
        () => sendPushNotification(engineerId, "Verification needs a look", "We couldn't verify your Gas Safe number — check it and try again.", { url: "/more" }),
      ];
  for (const send of sends) {
    try {
      await withTimeout(send(), NOTICE_TIMEOUT_MS);
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
function afterResponse(task: () => Promise<void>): Promise<void> | void {
  try {
    after(task);
  } catch {
    return task();
  }
}

/**
 * Claim a waiting application for this admin, or refresh their claim. Someone
 * else's fresh claim wins: the answer then says who holds it. Claims on one
 * application are taken one at a time (a transaction-scoped advisory lock), so
 * two admins opening it together can't both get it.
 */
export async function claimVerification(admin: AdminPrincipal, engineerId: string) {
  const row = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { id: true, gasSafeNo: true, gasSafeVerifiedAt: true, gasSafeRejectedAt: true } });
  if (!row) throw notFound("There's no engineer with that ID.");
  if (verificationStatus(row) !== "pending") return { claimed: false, lock: null };
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
  const now = new Date();
  // "Move straight on" stays in the same tab: the next new application, or the next flagged duplicate.
  const waiting = await waitingQueue();
  const flagged = (id: string) => (waiting.duplicates.get(id)?.length ?? 0) > 0;
  const sameTab = waiting.rows.filter((r) => r.id !== engineerId && flagged(r.id) === flagged(engineerId));
  const held = (await freshClaims([engineerId])).get(engineerId);
  if (held && held.adminId !== admin.id) throw conflict(`${held.adminName} is checking this application right now. Try again once they've finished.`);
  if (input.duplicateOf && !(await prisma.engineer.count({ where: { id: input.duplicateOf, NOT: { id: engineerId } } }))) {
    throw notFound("The account it duplicates doesn't exist.");
  }
  // The decision, the released claim and the record of who decided are saved
  // together; the engineer is told once they are.
  await prisma.$transaction(async (tx) => {
    // Held until the transaction ends, so nothing changes between the check and the decision.
    await tx.$executeRaw`SELECT id FROM "Engineer" WHERE id = ${engineerId} FOR UPDATE`;
    if (input.revision) {
      const current = await tx.engineer.findFirst({ where: { id: engineerId, ...live }, select: REVISION_SELECT });
      if (current && revisionOf(current) !== input.revision && verificationStatus(current) === "pending") {
        throw conflict("This application changed while you had it open. Reload to see the latest before deciding.");
      }
    }
    // Only while it's still waiting, so two admins can't both decide it.
    const { count } = await tx.engineer.updateMany({
      where: { id: engineerId, ...TAB_WHERE.pending },
      data: approved
        ? { gasSafeVerifiedAt: now, gasSafeRejectedAt: null, gasSafeRejectReason: null }
        : { gasSafeRejectedAt: now, gasSafeRejectReason: reason },
    });
    if (count === 0) {
      const exists = await tx.engineer.findFirst({ where: { id: engineerId, ...live }, select: { gasSafeNo: true } });
      if (!exists) throw notFound("There's no engineer with that ID.");
      if (!exists.gasSafeNo) throw conflict("This engineer hasn't submitted a Gas Safe number yet.");
      throw conflict("This application has already been decided.");
    }
    await tx.verificationClaim.deleteMany({ where: { engineerId } });
    await adminEvent(
      admin,
      approved ? "gas_safe_verified" : "gas_safe_rejected",
      { engineerId, reason, before: "pending", ...(input.duplicateOf ? { duplicateOf: input.duplicateOf } : {}) },
      tx,
    );
  });
  await afterResponse(() => tellEngineer(engineerId, approved, reason));
  return { id: engineerId, outcome: approved ? ("verified" as const) : ("rejected" as const), decidedAt: now.toISOString(), nextId: sameTab[0]?.id ?? null };
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
