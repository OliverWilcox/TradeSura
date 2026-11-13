import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { appUrl } from "@/lib/app-url";

// Matt, 4 Nov: an engineer's referral code is short and readable (SMITH25),
// printed on the cover letter with a QR to tradesura.com/r/{code}, and the
// same everywhere the app shares it. Made the first time it's needed and
// kept. Links shared before codes existed (/r/{slug}, /join/{slug}) still work.

// Long enough for most surnames whole (MUELLER, WILKINSON): a code cut mid-word reads like a typo.
const MAX_LETTERS = 10;

/** Letters from the surname (its first part, if double-barrelled), else the business name: SMITH, OBRIEN, BRIGHT. */
export function codeStem(e: { lastName: string | null; tradingName: string | null; legalName: string | null }): string {
  const source = [e.lastName, e.tradingName, e.legalName].find((s) => (s ?? "").replace(/[^a-z]/gi, "").length >= 2) ?? "";
  const word = source.split(/[\s-]+/).find((w) => w.replace(/[^a-z]/gi, "").length >= 2) ?? "";
  return word.replace(/[^a-z]/gi, "").toUpperCase().slice(0, MAX_LETTERS) || "TS";
}

/** A code with two digits, three once two keep clashing: SMITH25, SMITH407. */
export function makeCode(stem: string, attempt: number): string {
  const digits = attempt < 15 ? randomInt(10, 100) : attempt < 30 ? randomInt(100, 1000) : randomInt(1000, 10000);
  return `${stem}${digits}`;
}

/** The link a code prints as. */
export function referralLink(code: string): string {
  return `${appUrl()}/r/${code}`;
}

/** Codes are kept upper case; what someone types or follows is matched whatever its case. */
export const normaliseCode = (code: string) => code.trim().toUpperCase();

/** The engineer's code, made and saved now if they haven't one. */
export async function ensureReferralCode(engineerId: string): Promise<string> {
  const e = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { referralCode: true, lastName: true, tradingName: true, legalName: true } });
  if (e.referralCode) return e.referralCode;
  const stem = codeStem(e);
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = makeCode(stem, attempt);
    try {
      // Only while it's still unset, so two requests at once agree on one code.
      const { count } = await prisma.engineer.updateMany({ where: { id: engineerId, referralCode: null }, data: { referralCode: code } });
      if (count) return code;
      return (await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { referralCode: true } })).referralCode!;
    } catch (err) {
      // Another engineer has it: try again.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error(`No free referral code for ${stem}`);
}

/** Codes for several engineers at once (print files), made where missing. */
export async function ensureReferralCodes(engineerIds: string[]): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  for (const id of engineerIds) codes.set(id, await ensureReferralCode(id));
  return codes;
}

/** Who a code or an older slug link belongs to. */
export async function findReferrer(codeOrSlug: string) {
  const value = codeOrSlug.trim();
  if (!value) return null;
  return (
    (await prisma.engineer.findUnique({ where: { referralCode: normaliseCode(value) } })) ??
    (await prisma.engineer.findUnique({ where: { slug: value.toLowerCase() } }))
  );
}
