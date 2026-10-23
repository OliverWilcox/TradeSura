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
export function brandName<T extends { tradingName: string | null; legalName?: string | null; slug: string }>(
  engineer: T,
): string {
  return displayName(engineer);
}

type Named = { tradingName: string | null; legalName?: string | null; slug: string };

// Build Review 3, section 2 — a limited company may leave its trading name
// blank and trade under its Companies House name. Sign-up copies that name
// into tradingName in that case, so brandName() already covers it; this is
// the belt-and-braces fallback for a row where only legalName is set.
export function displayName(engineer: Named): string {
  return engineer.tradingName?.trim() || engineer.legalName?.trim() || engineer.slug;
}

// Compared without case, punctuation or a trailing Ltd/Limited, so "Smith
// Heating" trading as SMITH HEATING LTD isn't told it's a trading name.
function nameKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .replace(/\b(ltd|limited|llp|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Build Review 3, section 2 — "When a trading name differs from the legal
// name, customer pages show 'MW Heating is a trading name of …'", with the
// registered name exactly as Companies House has it ("302 MD LTD").
// Null when there's no legal name on file or the two are the same name.
export function tradingNameOf(engineer: Named): string | null {
  const legal = engineer.legalName?.trim();
  const trading = engineer.tradingName?.trim();
  if (!legal || !trading || nameKey(legal) === nameKey(trading)) return null;
  return `${trading} is a trading name of ${legal}`;
}

// R5 — prices show including VAT where the engineer is VAT registered;
// otherwise the existing wording is unchanged. `plain` is how the call site
// already wrote it ("/mo", "/month", " a month").
export function perMonth(priceLabel: string, vatRegistered: boolean | null | undefined, plain = " a month"): string {
  return vatRegistered ? `${priceLabel} a month including VAT` : `${priceLabel}${plain}`;
}

