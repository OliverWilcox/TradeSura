// Build Review 3, section 5 — the rules a plan must meet before it can go
// live, checked on the server whatever the app sends.
import { prisma } from "@/lib/db";
import {
  CLAUSE_TEMPLATES,
  QUALIFICATION_PROMPTS,
  missingRateError,
  serviceRuleError,
} from "@/lib/clauses";

export type GoLiveError = { error: string; code: string };

export function confirmedQualifications(raw: unknown): Record<string, string> {
  return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
}

export async function goLiveError(
  engineerId: string,
  codes: string[],
  rates: Record<string, string>,
  name?: string,
): Promise<GoLiveError | null> {
  if (name !== undefined && name.trim().length < 2) {
    return { error: "Give your plan a name before it goes live.", code: "name_required" };
  }
  const service = serviceRuleError(codes);
  if (service) return { error: service, code: "maintenance_required" };
  const rate = missingRateError(codes, rates);
  if (rate) return { error: rate, code: "rate_required" };
  const needed = codes.filter((c) => QUALIFICATION_PROMPTS[c]);
  if (needed.length) {
    const engineer = await prisma.engineer.findUnique({
      where: { id: engineerId },
      select: { qualificationConfirmations: true },
    });
    const confirmed = confirmedQualifications(engineer?.qualificationConfirmations);
    const missing = needed.filter((c) => !confirmed[c]);
    if (missing.length) {
      const titles = missing.map((c) => CLAUSE_TEMPLATES.find((t) => t.code === c)?.title ?? c);
      return {
        error: `Confirm you're qualified for ${titles.join(" and ")} before this plan goes live.`,
        code: "qualification_required",
      };
    }
  }
  return null;
}
