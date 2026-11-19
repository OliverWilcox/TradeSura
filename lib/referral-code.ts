import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { appUrl } from "@/lib/app-url";

const MAX_LETTERS = 10;

export function codeStem(e: { lastName: string | null; tradingName: string | null; legalName: string | null }): string {
  const source = [e.lastName, e.tradingName, e.legalName].find((s) => (s ?? "").replace(/[^a-z]/gi, "").length >= 2) ?? "";
  const word = source.split(/[\s-]+/).find((w) => w.replace(/[^a-z]/gi, "").length >= 2) ?? "";
  return word.replace(/[^a-z]/gi, "").toUpperCase().slice(0, MAX_LETTERS) || "TS";
}

export function makeCode(stem: string, attempt: number): string {
  const digits = attempt < 15 ? randomInt(10, 100) : attempt < 30 ? randomInt(100, 1000) : randomInt(1000, 10000);
  return `${stem}${digits}`;
}

export function referralLink(code: string): string {
  return `${appUrl()}/r/${code}`;
}

export const normaliseCode = (code: string) => code.trim().toUpperCase();

export async function ensureReferralCode(engineerId: string): Promise<string> {
  const e = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { referralCode: true, lastName: true, tradingName: true, legalName: true } });
  if (e.referralCode) return e.referralCode;
  const stem = codeStem(e);
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = makeCode(stem, attempt);
    try {
      const { count } = await prisma.engineer.updateMany({ where: { id: engineerId, referralCode: null }, data: { referralCode: code } });
      if (count) return code;
      return (await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { referralCode: true } })).referralCode!;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error(`No free referral code for ${stem}`);
}

export async function ensureReferralCodes(engineerIds: string[]): Promise<Map<string, string>> {
  const codes = new Map<string, string>();
  for (const id of engineerIds) codes.set(id, await ensureReferralCode(id));
  return codes;
}

export async function findReferrer(codeOrSlug: string) {
  const value = codeOrSlug.trim();
  if (!value) return null;
  return (
    (await prisma.engineer.findUnique({ where: { referralCode: normaliseCode(value) } })) ??
    (await prisma.engineer.findUnique({ where: { slug: value.toLowerCase() } }))
  );
}
