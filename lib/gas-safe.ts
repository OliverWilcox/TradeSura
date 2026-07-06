import { prisma } from "@/lib/db";

// Gas Safe registration numbers are digits; users type them with spaces.
// Returns digits-only form, or null if the input can't be a registration number.
export function normaliseRegNo(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /[a-z]/i.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 8) return null;
  return digits;
}

export async function verifyGasSafe(input: string) {
  const regNo = normaliseRegNo(input);
  if (!regNo) return null;
  return prisma.gasSafeRecord.findUnique({ where: { regNo } });
}
