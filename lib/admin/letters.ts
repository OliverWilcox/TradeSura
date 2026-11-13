import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { AddressInput, formatAddress, parseAddress } from "@/lib/addresses";
import { adminEvent } from "@/lib/admin-api/audit";
import { AdminApiError, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { addDays, ukDay } from "@/lib/admin/time";
import { foundingDeadline, foundingDeadlineKey } from "@/lib/founding";
import { claimLink, letterCodeSuffix } from "@/lib/letter-code";
import { codeStem } from "@/lib/referral-code";
import { townSlugOf } from "@/lib/town";

// Letter batches for the admin API (Matt, 4 Nov). Uploading a batch makes a
// real, reserved ClaimCode for every engineer on it before anything is
// posted: a code that can't be guessed (SMITH-7K3Q), its claim link
// (tradesura.com/c/CODE, the letter's QR), the town printed on the letter and
// the reservation date. Our list stays back office: the claim page and the
// app show back only the business name and town (lib/claim.ts); the mailing
// address goes to the mail house's file and nowhere else.

export const MAX_LETTERS_PER_BATCH = 5000;
const VARIANTS = ["A", "B", "C", "D"] as const;

export const LetterRow = z.strictObject({
  businessName: z.string().trim().min(1).max(120),
  firstName: z.string().trim().min(1).max(60),
  /** Their surname, when the list has it: the code starts with it, else with the business name. */
  lastName: z.string().trim().max(60).optional(),
  /** The town printed on the letter: where they work, and the town of their Founding place. */
  town: z.string().trim().min(1).max(80).refine((t) => townSlugOf(t) !== "", "Enter the town's name."),
  mailingAddress: AddressInput.optional(),
  /** The letter's split-test version; A when the list doesn't say. */
  variant: z.enum(VARIANTS).optional(),
});
export type LetterRow = z.output<typeof LetterRow>;

export type LetterBatch = {
  name: string;
  /** The reservation date the letters print (the latest, if codes in the batch differ). */
  reservedUntil: string;
  codes: number;
  /** Confirmed their details on the claim page. */
  claimed: number;
  /** Signed up with the code. */
  signedUp: number;
  /** Opted out: left out of the mail house's file. */
  suppressed: number;
  uploadedAt: string;
  uploadedBy: string | null;
};

/** Every batch, newest first, with how far its codes have got. */
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
  const items = await Promise.all(
    groups.map(async (g): Promise<LetterBatch> => {
      const createdAt = g._min.createdAt!;
      // Batches from before uploads carry no date of their own: the letter date their codes are judged by.
      const reserved = g._max.reservedUntil ?? (await foundingDeadline({ letterBatch: g.letterBatch, createdAt }));
      return {
        name: g.letterBatch,
        reservedUntil: g._max.reservedUntil ? g._max.reservedUntil.toISOString().slice(0, 10) : ukDay(reserved),
        codes: g._count._all,
        claimed: g._count.claimedAt,
        signedUp: g._count.redeemedByEngineerId,
        suppressed: g._count.suppressedAt,
        uploadedAt: createdAt.toISOString(),
        uploadedBy: uploader.get(g.letterBatch) ?? null,
      };
    }),
  );
  return { items: items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt) || b.name.localeCompare(a.name)) };
}

/** This month's next batch name: 2026-11-A, then 2026-11-B. */
function nextBatchName(month: string, taken: string[]): string {
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const name = `${month}-${letter}`;
    if (!taken.includes(name)) return name;
  }
  throw new AdminApiError(409, "CONFLICT", "That's 26 batches this month already. Upload it next month, or ask for more batch names.");
}

/** A code for each row, none the same as another or as one already given. */
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

/**
 * Upload a batch: every row becomes a reserved code at once, or none do. The
 * reservation date is the letter date Founding is judged by, so it's also
 * the batch's founding_deadline setting.
 */
export async function uploadLetterBatch(admin: AdminPrincipal, input: { reservedUntil: string; rows: LetterRow[] }, now = new Date()) {
  const today = ukDay(now);
  if (input.reservedUntil <= today) throw new AdminApiError(400, "VALIDATION", "The reservation date has to be after today.", { reservedUntil: ["The reservation date has to be after today."] });
  if (input.reservedUntil > addDays(today, 366)) throw new AdminApiError(400, "VALIDATION", "The reservation date has to be within a year.", { reservedUntil: ["The reservation date has to be within a year."] });
  return prisma.$transaction(
    async (tx) => {
      // One upload at a time, so two can't take the same batch name.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('letter_batch_upload'))`;
      const month = today.slice(0, 7);
      const taken = await tx.claimCode.findMany({ where: { letterBatch: { startsWith: `${month}-` } }, distinct: ["letterBatch"], select: { letterBatch: true } });
      const name = nextBatchName(month, taken.map((t) => t.letterBatch));
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
      await adminEvent(admin, "letter_batch_uploaded", { batch: name, count: codes.length, reservedUntil: input.reservedUntil }, tx);
      return { name, count: codes.length, reservedUntil: input.reservedUntil };
    },
    { timeout: 60_000 },
  );
}

const MAIL_HOUSE_ORDER = [{ town: "asc" as const }, { businessName: "asc" as const }, { code: "asc" as const }];

/**
 * The mail house's file for one batch: who each letter is to, the town and
 * reservation date it prints, its code and QR link, and where it goes.
 * Codes whose owner opted out are left out, and counted.
 */
export async function mailHouseFile(batch: string) {
  const rows = await prisma.claimCode.findMany({
    where: { letterBatch: batch },
    orderBy: MAIL_HOUSE_ORDER,
    select: { code: true, firstName: true, businessName: true, town: true, reservedUntil: true, mailingAddress: true, suppressedAt: true, letterBatch: true, createdAt: true },
  });
  if (!rows.length) throw notFound("There's no letter batch with that name.");
  const letters = rows.filter((r) => !r.suppressedAt);
  // Codes from before uploads have no date of their own: the batch's letter date, worked out once.
  const loadedAt = new Date(Math.min(...rows.map((r) => r.createdAt.getTime())));
  const batchDay = rows.some((r) => !r.reservedUntil) ? ukDay(await foundingDeadline({ letterBatch: batch, createdAt: loadedAt })) : null;
  return {
    batch,
    suppressed: rows.length - letters.length,
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
