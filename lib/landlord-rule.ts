// 30 Oct update §7.4 — "landlord plans must never give more for less than
// the matching homeowner plan". A landlord plan that includes everything a
// homeowner plan does (it gives at least as much) must cost at least as much,
// or homeowners would be better off on the landlord price. Checked when a
// plan goes live and when a live plan's price or items change.
import { isLandlordPlan } from "@/lib/clauses";
import { poundsLabel } from "@/lib/billing-interval";

export type RuleTier = { id: string; name: string; priceMonthlyPence: number; codes: string[] };

export function landlordPriceError(candidate: RuleTier, liveTiers: RuleTier[]): string | null {
  const others = liveTiers.filter((t) => t.id !== candidate.id);
  const candidateLandlord = isLandlordPlan(candidate.codes);
  for (const other of others) {
    const otherLandlord = isLandlordPlan(other.codes);
    if (candidateLandlord === otherLandlord) continue;
    const [landlord, home] = candidateLandlord ? [candidate, other] : [other, candidate];
    const givesAllOfHome = home.codes.every((c) => landlord.codes.includes(c));
    if (givesAllOfHome && landlord.priceMonthlyPence < home.priceMonthlyPence) {
      return candidateLandlord
        ? `${landlord.name} includes everything in ${home.name}, so it can't cost less than ${home.name} (${poundsLabel(home.priceMonthlyPence)} a month).`
        : `${landlord.name} includes everything in ${home.name}, so ${home.name} can't cost more than ${landlord.name} (${poundsLabel(landlord.priceMonthlyPence)} a month).`;
    }
  }
  return null;
}
