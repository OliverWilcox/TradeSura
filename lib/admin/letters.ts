import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AddressInput, formatAddress, parseAddress } from "@/lib/addresses";
import { adminEvent } from "@/lib/admin-api/audit";
import { AdminApiError, conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { addDays, formatUkDate, ukDay } from "@/lib/admin/time";
import { foundingDeadline, foundingDeadlineKey } from "@/lib/founding";
import { claimLink, letterCodeSuffix, printedLinkProblem } from "@/lib/letter-code";
import { appUrl } from "@/lib/app-url";
import { codeStem } from "@/lib/referral-code";
import { townSlugOf } from "@/lib/town";
import { claimAppLink, claimAppToken } from "@/lib/claim";
import { sendPlatformText } from "@/lib/sms";
import { isSuppressed } from "@/lib/suppression";
import { track } from "@/lib/track";

export const MAX_LETTERS_PER_BATCH = 5000;
export const BATCH_NAME = /^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/;
export const POSTED_WINDOW_DAYS = { before: 90, after: 60 } as const;
const VARIANTS = ["A", "B", "C", "D"] as const;

export const LetterRow = z.strictObject({
  businessName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().max(60).optional(),
  town: z.string().trim().min(1).max(80).refine((t) => townSlugOf(t) !== "", "Enter the town's name."),
  mailingAddress: AddressInput.optional(),
  variant: z.enum(VARIANTS).optional(),
});
export type LetterRow = z.output<typeof LetterRow>;

export type LetterBatch = {
  name: string;
  area: string | null;
  postedOn: string | null;
  planned: number | null;
  reservedUntil: string;
  codes: number;
  claimed: number;
  signedUp: number;
  suppressed: number;
  unclaimed: number;
  notSignedUp: number;
  canText: number;
  texted: number;
  secondLetterFrom: string;
  uploadedAt: string;
  uploadedBy: string | null;
};

export const SECOND_LETTER_DAYS = 10;
export const REMINDERS_PER_SEND = 200;

export const notSignedUpWhere = (batch?: string) =>
  ({ ...(batch ? { letterBatch: batch } : {}), claimedAt: { not: null }, redeemedByEngineerId: null, suppressedAt: null }) satisfies Prisma.ClaimCodeWhereInput;

export const textableWhere = (batch?: string) => ({ ...notSignedUpWhere(batch), mobile: { not: null }, textConsentAt: { not: null } }) satisfies Prisma.ClaimCodeWhereInput;

export async function listLetterBatches(): Promise<{ items: LetterBatch[] }> {
  const groups = await prisma.claimCode.groupBy({
    by: ["letterBatch"],
    _count: { _all: true, claimedAt: true, redeemedByEngineerId: true, suppressedAt: true },
    _min: { createdAt: true },
    _max: { reservedUntil: true },
  });
  const uploads = groups.length
    ? await prisma.event.findMany({
        where: { name: "letter_batch_uploaded", OR: groups.map((g) => ({ meta: { path: ["batch"], equals: g.letterBatch } })) },
        select: { meta: true },
      })
    : [];
  const uploader = new Map(uploads.map((u) => [(u.meta as { batch: string }).batch, (u.meta as { adminName?: string }).adminName ?? null]));
  const info = new Map((await prisma.letterBatch.findMany()).map((b) => [b.name, b]));
  const unclaimed = await prisma.claimCode.groupBy({ by: ["letterBatch"], where: { claimedAt: null, redeemedByEngineerId: null, suppressedAt: null }, _count: { _all: true } });
  const unclaimedOf = new Map(unclaimed.map((u) => [u.letterBatch, u._count._all]));
  const [notSignedUp, canText, texted] = await Promise.all([
    prisma.claimCode.groupBy({ by: ["letterBatch"], where: notSignedUpWhere(), _count: { _all: true } }),
    prisma.claimCode.groupBy({ by: ["letterBatch"], where: { ...textableWhere(), reminderTextedAt: null }, _count: { _all: true } }),
    prisma.claimCode.groupBy({ by: ["letterBatch"], where: { reminderTextedAt: { not: null } }, _count: { _all: true } }),
  ]);
  const countOf = (rows: { letterBatch: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.letterBatch, r._count._all]));
  const [notSignedUpOf, canTextOf, textedOf] = [countOf(notSignedUp), countOf(canText), countOf(texted)];
  const items = await Promise.all(
    groups.map(async (g): Promise<LetterBatch> => {
      const createdAt = g._min.createdAt!;
      const reserved = g._max.reservedUntil ?? (await foundingDeadline({ letterBatch: g.letterBatch, createdAt }));
      const batch = info.get(g.letterBatch);
      return {
        name: g.letterBatch,
        area: batch?.area ?? null,
        postedOn: batch ? batch.postedOn.toISOString().slice(0, 10) : null,
        planned: batch?.letters ?? null,
        reservedUntil: g._max.reservedUntil ? g._max.reservedUntil.toISOString().slice(0, 10) : ukDay(reserved),
        codes: g._count._all,
        claimed: g._count.claimedAt,
        signedUp: g._count.redeemedByEngineerId,
        suppressed: g._count.suppressedAt,
        unclaimed: unclaimedOf.get(g.letterBatch) ?? 0,
        notSignedUp: notSignedUpOf.get(g.letterBatch) ?? 0,
        canText: canTextOf.get(g.letterBatch) ?? 0,
        texted: textedOf.get(g.letterBatch) ?? 0,
        secondLetterFrom: addDays(batch ? batch.postedOn.toISOString().slice(0, 10) : ukDay(createdAt), SECOND_LETTER_DAYS),
        uploadedAt: createdAt.toISOString(),
        uploadedBy: uploader.get(g.letterBatch) ?? null,
      };
    }),
  );
  return { items: items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.name.localeCompare(a.name)) };
}

const invalid = (field: string, message: string) => new AdminApiError(400, "VALIDATION", message, { [field]: [message] });

async function uniqueCodes(rows: LetterRow[], db: Prisma.TransactionClient): Promise<string[]> {
  const stems = rows.map((r) => codeStem({ lastName: r.lastName ?? null, tradingName: r.businessName, legalName: null }));
  const codes = stems.map((s) => `${s}-${letterCodeSuffix()}`);
  for (let round = 0; round < 10; round++) {
    const taken = new Set((await db.claimCode.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
    const seen = new Set<string>();
    const clashes = codes.flatMap((c, i) => (taken.has(c) || seen.has(c) ? [i] : (seen.add(c), [])));
    if (!clashes.length) return codes;
    for (const i of clashes) codes[i] = `${stems[i]}-${letterCodeSuffix()}`;
  }
  throw new Error("Couldn't make unique letter codes");
}

export async function uploadLetterBatch(
  admin: AdminPrincipal,
  input: { name: string; area: string; postedOn: string; count: number; reservedUntil: string; rows: LetterRow[] },
  now = new Date(),
) {
  const today = ukDay(now);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (input.count !== input.rows.length) throw invalid("count", `The list has ${input.rows.length} letter${input.rows.length === 1 ? "" : "s"}, not ${input.count}. Check the count or the file.`);
  if (input.postedOn < addDays(today, -POSTED_WINDOW_DAYS.before) || input.postedOn > addDays(today, POSTED_WINDOW_DAYS.after)) {
    throw invalid("postedOn", `The date posted has to be within ${POSTED_WINDOW_DAYS.before} days before today and ${POSTED_WINDOW_DAYS.after} days after.`);
  }
  if (input.reservedUntil <= today) throw invalid("reservedUntil", "The reservation date has to be after today.");
  if (input.reservedUntil > addDays(today, 366)) throw invalid("reservedUntil", "The reservation date has to be within a year.");
  if (input.reservedUntil <= input.postedOn) throw invalid("reservedUntil", "The reservation date has to be after the date posted.");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('letter_batch_upload'))`;
      const [batchTaken, codesTaken] = await Promise.all([
        tx.letterBatch.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { name: true } }),
        tx.claimCode.findFirst({ where: { letterBatch: { equals: name, mode: "insensitive" } }, select: { code: true } }),
      ]);
      if (batchTaken || codesTaken) throw new AdminApiError(409, "CONFLICT", `There's already a batch called ${name}. Give this one another name.`);
      const codes = await uniqueCodes(input.rows, tx);
      const reservedUntil = new Date(`${input.reservedUntil}T00:00:00Z`);
      await tx.claimCode.createMany({
        data: input.rows.map((r, i) => ({
          code: codes[i]!,
          firstName: r.firstName,
          businessName: r.businessName,
          town: r.town,
          letterBatch: name,
          variantCell: r.variant ?? "A",
          reservedUntil,
          mailingAddress: r.mailingAddress ? formatAddress(r.mailingAddress) : null,
          createdAt: now,
        })),
      });
      await tx.appSetting.upsert({
        where: { key: foundingDeadlineKey(name) },
        create: { key: foundingDeadlineKey(name), value: input.reservedUntil },
        update: { value: input.reservedUntil },
      });
      await tx.letterBatch.create({
        data: { name, area: input.area.trim(), postedOn: new Date(`${input.postedOn}T00:00:00Z`), letters: codes.length, createdById: admin.id, createdBy: admin.name },
      });
      await adminEvent(admin, "letter_batch_uploaded", { batch: name, area: input.area.trim(), postedOn: input.postedOn, count: codes.length, reservedUntil: input.reservedUntil }, tx);
      return { name, area: input.area.trim(), postedOn: input.postedOn, count: codes.length, reservedUntil: input.reservedUntil };
    },
    { timeout: 60_000 },
  );
}

const MAIL_HOUSE_ORDER = [{ town: "asc" as const }, { businessName: "asc" as const }, { code: "asc" as const }];

export async function mailHouseFile(batch: string, opts: { second?: boolean } = {}, now = new Date()) {
  const linkProblem = printedLinkProblem();
  if (linkProblem) throw new AdminApiError(409, "CONFLICT", `${linkProblem} Set APP_URL to the live site before sending letters to the mail house: printed codes can't be changed.`);
  const rows = await prisma.claimCode.findMany({
    where: { letterBatch: batch },
    orderBy: MAIL_HOUSE_ORDER,
    select: { code: true, firstName: true, businessName: true, town: true, reservedUntil: true, mailingAddress: true, suppressedAt: true, letterBatch: true, createdAt: true, claimedAt: true, redeemedByEngineerId: true },
  });
  if (!rows.length) throw notFound("There's no letter batch with that name.");
  if (opts.second) {
    const info = await prisma.letterBatch.findUnique({ where: { name: batch }, select: { postedOn: true } });
    const from = addDays(info ? info.postedOn.toISOString().slice(0, 10) : ukDay(new Date(Math.min(...rows.map((r) => r.createdAt.getTime())))), SECOND_LETTER_DAYS);
    if (ukDay(now) < from) throw new AdminApiError(409, "CONFLICT", `The second letter goes out ${SECOND_LETTER_DAYS} to 14 days after the first: this batch's can go from ${from}.`);
  }
  const letters = rows.filter((r) => !r.suppressedAt && (!opts.second || (!r.claimedAt && !r.redeemedByEngineerId)));
  const loadedAt = new Date(Math.min(...rows.map((r) => r.createdAt.getTime())));
  const batchDay = rows.some((r) => !r.reservedUntil) ? ukDay(await foundingDeadline({ letterBatch: batch, createdAt: loadedAt })) : null;
  return {
    batch,
    linkBase: appUrl(),
    second: Boolean(opts.second),
    suppressed: rows.filter((r) => r.suppressedAt).length,
    responded: opts.second ? rows.filter((r) => !r.suppressedAt && (r.claimedAt || r.redeemedByEngineerId)).length : 0,
    rows: letters.map((r) => ({
      businessName: r.businessName,
      firstName: r.firstName,
      town: r.town,
      reservedUntil: r.reservedUntil ? r.reservedUntil.toISOString().slice(0, 10) : batchDay!,
      code: r.code,
      link: claimLink(r.code),
      mailingAddress: parseAddress(r.mailingAddress),
    })),
  };
}

async function followUpFrom(batch: string): Promise<string | null> {
  const [info, first] = await Promise.all([
    prisma.letterBatch.findUnique({ where: { name: batch }, select: { postedOn: true } }),
    prisma.claimCode.findFirst({ where: { letterBatch: batch }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  if (!info && !first) return null;
  return addDays(info ? info.postedOn.toISOString().slice(0, 10) : ukDay(first!.createdAt), SECOND_LETTER_DAYS);
}

export function reminderText(r: { code: string; town: string | null; deadline: Date; link: string }, now = new Date()) {
  const held = r.town && now <= r.deadline ? `your Founding Member spot in ${r.town} is held until ${formatUkDate(r.deadline)}. ` : "your account is waiting. ";
  return `TradeSura: ${held}Finish setting up with your code ${r.code}: ${r.link} Reply STOP to opt out.`;
}

export async function sendLetterReminders(admin: AdminPrincipal, batch: string, now = new Date()) {
  const from = await followUpFrom(batch);
  if (!from) throw notFound("There's no letter batch with that name.");
  if (ukDay(now) < from) throw conflict(`Reminder texts go with the second letter, ${SECOND_LETTER_DAYS} days after the first: this batch's can go from ${from}.`);
  const rows = await prisma.claimCode.findMany({
    where: { ...textableWhere(batch), reminderTextedAt: null },
    orderBy: { claimedAt: "asc" },
    take: REMINDERS_PER_SEND,
    select: { code: true, mobile: true, town: true, tradingTown: true, letterBatch: true, createdAt: true, reservedUntil: true, variantCell: true },
  });
  if (!rows.length) throw conflict("Nobody in this batch is waiting for a reminder: only those who gave their mobile and ticked the box on the claim page are texted, once.");
  const base = appUrl();
  const result = { sent: 0, failed: 0, optedOut: 0 };
  for (const r of rows) {
    if (await isSuppressed("sms", r.mobile!)) {
      result.optedOut++;
      await prisma.claimCode.update({ where: { code: r.code }, data: { reminderTextedAt: now } });
      continue;
    }
    const link = claimAppLink(base, r.code, await claimAppToken(r.code));
    const text = reminderText({ code: r.code, town: r.tradingTown?.trim() || r.town, deadline: await foundingDeadline(r), link }, now);
    const went = await sendPlatformText(r.mobile!, text).catch(() => false);
    if (went) {
      result.sent++;
      await prisma.claimCode.update({ where: { code: r.code }, data: { reminderTextedAt: now } });
    } else result.failed++;
    await track("claim_step", { type: "SYSTEM" }, { code: r.code, step: "reminder_texted", delivered: went, variantCell: r.variantCell });
  }
  const left = await prisma.claimCode.count({ where: { ...textableWhere(batch), reminderTextedAt: null } });
  await adminEvent(admin, "letter_reminders_sent", { batch, ...result, left });
  return { ...result, left };
}

async function claimRow(code: string) {
  const row = await prisma.claimCode.findUnique({ where: { code }, select: { code: true, mobile: true, letterBatch: true } });
  if (!row) throw notFound("There's no claim code like that.");
  return row;
}

export async function revealClaimContact(admin: AdminPrincipal, code: string) {
  const row = await claimRow(code);
  await adminEvent(admin, "admin_contact_revealed", { subjectType: "claim_code", subjectId: row.code, batch: row.letterBatch, field: "phone" });
  return { phone: row.mobile };
}

export async function logClaimCall(admin: AdminPrincipal, code: string, note: string) {
  const row = await claimRow(code);
  const at = new Date();
  await adminEvent(admin, "claim_called", { code: row.code, batch: row.letterBatch, note });
  return { at: at.toISOString(), by: admin.name };
}
