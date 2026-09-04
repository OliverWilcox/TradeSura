import { prisma } from "@/lib/db";

// Forgiving of case, spaces and dashes: "ts 48217" / "TS-48217" → "TS-48217".
export function normaliseClaimCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = cleaned.match(/^TS(\d{4,8})$/);
  return m ? `TS-${m[1]}` : cleaned;
}

export type ResolvedClaim =
  | { valid: true; personalised: boolean; firstName?: string; businessName?: string; letterBatch: string; variantCell: string }
  | { valid: false };

export async function resolveClaimCode(input: string): Promise<ResolvedClaim> {
  const code = normaliseClaimCode(input);
  const row = await prisma.claimCode.findUnique({ where: { code } });
  if (!row) return { valid: false };
  // Suppressed (opted out): the code still works, but no personalisation.
  if (row.suppressedAt) {
    return { valid: true, personalised: false, letterBatch: row.letterBatch, variantCell: row.variantCell };
  }
  return {
    valid: true,
    personalised: true,
    firstName: row.firstName,
    businessName: row.businessName,
    letterBatch: row.letterBatch,
    variantCell: row.variantCell,
  };
}
