// Build Review 3, section 5 — the rules a plan must meet before it can go
// live, checked on the server whatever the app sends.
import { prisma } from "@/lib/db";
import {
  CLAUSE_TEMPLATES,
  QUALIFICATION_PROMPTS,
  TIER_PRICE_MIN_PENCE,
  cleanRates,
  missingRateError,
  serviceRuleError,
} from "@/lib/clauses";
import { checkWording } from "@/lib/compliance/blocklist";
import { landlordPriceError } from "@/lib/landlord-rule";

export type GoLiveError = { error: string; code: string };

export function confirmedQualifications(raw: unknown): Record<string, string> {
  return raw && typeof raw === "object" ? (raw as Record<string, string>) : {};
}

// The "you set the rate" boxes are free text on the customer's plan page, so
// they pass the same word filter as the plan name.
export function rateWordingError(raw: unknown): GoLiveError | null {
  for (const [code, rate] of Object.entries(cleanRates(raw))) {
    if (checkWording(rate).ok) continue;
    const title = CLAUSE_TEMPLATES.find((t) => t.code === code)?.title ?? "this option";
    return {
      error: `Your rate for "${title}" can't say that: that wording makes this an insurance product. Enter just the rate, like 10% off.`,
      code: "rate_blocked",
    };
  }
  return null;
}

export async function goLiveError(
  engineerId: string,
  codes: string[],
  rates: Record<string, string>,
  name?: string,
  // 30 Oct update §5/§7.4 — the price starts blank, and a landlord plan can't
  // undercut the homeowner plan it contains.
  tier?: { id: string; priceMonthlyPence: number },
): Promise<GoLiveError | null> {
  if (name !== undefined && name.trim().length < 2) {
    return { error: "Give your plan a name before it goes live.", code: "name_required" };
  }
  if (tier && tier.priceMonthlyPence < TIER_PRICE_MIN_PENCE) {
    return { error: "Set your monthly price (£10 or more) before this plan goes live.", code: "price_required" };
  }
  const service = serviceRuleError(codes);
  if (service) return { error: service, code: "maintenance_required" };
  const rateWording = rateWordingError(rates);
  if (rateWording) return rateWording;
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
  if (tier) {
    const landlord = await landlordRuleError(engineerId, { ...tier, name: name ?? "", codes });
    if (landlord) return landlord;
  }
  return null;
}

/** §7.4 against the engineer's other live plans. */
export async function landlordRuleError(
  engineerId: string,
  candidate: { id: string; name: string; priceMonthlyPence: number; codes: string[] },
): Promise<GoLiveError | null> {
  const live = await prisma.planTier.findMany({
    where: { engineerId, status: "LIVE", id: { not: candidate.id } },
    select: { id: true, name: true, priceMonthlyPence: true, clauses: { select: { clause: { select: { code: true } } } } },
  });
  const error = landlordPriceError(
    candidate,
    live.map((t) => ({ id: t.id, name: t.name, priceMonthlyPence: t.priceMonthlyPence, codes: t.clauses.map((c) => c.clause.code) })),
  );
  return error ? { error, code: "landlord_price" } : null;
}
