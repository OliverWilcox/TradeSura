// Build Guide v2 review 17 Sept, B5 — "SMS campaign can send with an empty
// trading name... nothing in setup forces a trading name to exist." Signup
// and /api/settings both enforce tradingName.min(2) — client and server —
// so a *new* account can never reach either with an empty string. But every
// `engineer.tradingName ?? engineer.slug` fallback across the codebase (25
// call sites, before this file) only catches null/undefined — `??` treats
// "" as a defined value, so it never falls through to the slug. A legacy
// row carrying `tradingName: ""` (the exact account the review tested) hits
// that gap and produces precisely the reported bug: "Hi Dave — it's ."
//
// One shared helper, used everywhere a trading name needs a safe display
// fallback, so this class of bug can't reappear one call site at a time.
export function brandName<T extends { tradingName: string | null; slug: string }>(
  engineer: T,
): string {
  return engineer.tradingName?.trim() || engineer.slug;
}
