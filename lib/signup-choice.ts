// 30 Oct update §7.4 — which plans a customer sees and which one starts
// chosen. Pure, shared by the plan page, the personal offer link and tests.

export type ChoiceTier = { id: string; priceMonthlyPence: number; isRecommended: boolean; landlord: boolean };

/** Whether to ask "Are you a landlord?": only when both kinds of plan exist. */
export function hasLandlordChoice(tiers: Pick<ChoiceTier, "landlord">[]): boolean {
  return tiers.some((t) => t.landlord) && tiers.some((t) => !t.landlord);
}

/** The plans for the toggle's answer (all of them when there's no choice). */
export function tiersFor<T extends Pick<ChoiceTier, "landlord">>(tiers: T[], landlord: boolean): T[] {
  if (!hasLandlordChoice(tiers)) return tiers;
  return tiers.filter((t) => t.landlord === landlord);
}

/**
 * The plan that starts chosen: a plan the link names (a plan's own link or
 * the installer's offer), then the visit reason's pick, then the engineer's
 * "Most chosen", then with 3 plans the middle one by price ("most customers
 * pick the middle one"), else the first.
 */
export function defaultTierId(
  tiers: ChoiceTier[],
  opts: { initialTierId?: string | null; reasonTierId?: string | null } = {},
): string | undefined {
  const has = (id?: string | null) => (id && tiers.some((t) => t.id === id) ? id : undefined);
  const named = has(opts.initialTierId) ?? has(opts.reasonTierId);
  if (named) return named;
  const recommended = tiers.find((t) => t.isRecommended);
  if (recommended) return recommended.id;
  if (tiers.length === 3) return [...tiers].sort((a, b) => a.priceMonthlyPence - b.priceMonthlyPence)[1].id;
  return tiers[0]?.id;
}
