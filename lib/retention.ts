// Retention spec, sections 2 and 9 — the pure rules behind the cancel flow
// and the retention texts. No database here, so tests/retention.test.ts can
// pin the offer-by-reason logic and the "Before you go" figures.

export const CANCEL_REASONS = [
  { code: "too_expensive", label: "Too expensive" },
  { code: "moving", label: "Moving house" },
  { code: "not_using", label: "Not using it" },
  { code: "unhappy", label: "Unhappy with the engineer" },
  { code: "other", label: "Something else" },
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number]["code"];
export const CANCEL_REASON_CODES = CANCEL_REASONS.map((r) => r.code) as [CancelReason, ...CancelReason[]];

export function reasonLabel(code: string): string {
  return CANCEL_REASONS.find((r) => r.code === code)?.label ?? "Something else";
}

// What an annual service is worth on the "Before you go" screen (Matt's copy).
export const SERVICE_WORTH_PENCE = 8000;

// Win-back texts: 30 days after the plan ended, and again before winter.
export const WINBACK_DELAY_DAYS = 30;
export const WINTER_MONTH = 9; // October (0-based) — "before winter" is 1 October

export const ANNUAL_SERVICE_CODE = "ANNUAL_SERVICE";

// lines: what the plan includes, shown on the cheaper-plan offer (spec §2).
export type TierOption = { id: string; name: string; priceMonthlyPence: number; lines?: string[] };

export type Offer =
  | { kind: "cheaper_plan"; tier: TierOption; savingPence: number }
  | { kind: "move_plan" }
  | { kind: "show_value" }
  | { kind: "pause" };

// One tailored offer per reason. "Too expensive" offers the engineer's
// closest cheaper live plan (smallest step down, so they keep the most), or
// a pause when there's nothing cheaper.
export function offerForReason(
  reason: CancelReason,
  opts: { currentPricePence: number; currentTierId: string | null; liveTiers: TierOption[] },
): Offer {
  if (reason === "too_expensive") {
    const cheaper = opts.liveTiers
      .filter((t) => t.id !== opts.currentTierId && t.priceMonthlyPence < opts.currentPricePence)
      .sort((a, b) => b.priceMonthlyPence - a.priceMonthlyPence)[0];
    return cheaper
      ? { kind: "cheaper_plan", tier: cheaper, savingPence: opts.currentPricePence - cheaper.priceMonthlyPence }
      : { kind: "pause" };
  }
  if (reason === "moving") return { kind: "move_plan" };
  if (reason === "not_using") return { kind: "show_value" };
  return { kind: "pause" };
}

export function pounds(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

// What they've paid in so far. Yearly plans are 12 months for the price of
// 11, so one cleared yearly payment is 11 × the monthly price.
export function paidSoFarPence(plan: {
  paymentsCleared: number;
  priceMonthlyPence: number;
  billingInterval: string;
}): number {
  const perPayment = plan.billingInterval === "year" ? plan.priceMonthlyPence * 11 : plan.priceMonthlyPence;
  return Math.max(0, plan.paymentsCleared) * perPayment;
}

// "Pay as you go" style lower-casing for a clause title inside a sentence,
// leaving acronyms ("CP12", "CO alarm") alone.
function inSentence(title: string): string {
  const first = title.split(" ")[0];
  return first.length > 1 && first === first.toUpperCase() ? title : title.charAt(0).toLowerCase() + title.slice(1);
}

export type BeforeYouGo = {
  paidPence: number;
  paidLine: string;
  serviceLine: string | null;
  loseLines: string[];
};

// Matt's agreed copy, filled from live data. If the service has been used,
// the service line becomes "You've had your service (worth £80), plus …,
// all for £84".
export function beforeYouGo(opts: {
  brand: string;
  engineerFirstName: string | null;
  since: Date | null;
  paidPence: number;
  serviceUsed: boolean;
  clauses: { code: string; title: string }[];
}): BeforeYouGo {
  const hasService = opts.clauses.some((c) => c.code === ANNUAL_SERVICE_CODE);
  const others = opts.clauses.filter((c) => c.code !== ANNUAL_SERVICE_CODE).map((c) => c.title);
  const since = opts.since
    ? ` since ${opts.since.toLocaleDateString("en-GB", { month: "long", timeZone: "Europe/London" })}`
    : "";
  const paidLine = `You've paid ${pounds(opts.paidPence)} into your plan with ${opts.brand}${since}.`;
  const worth = pounds(SERVICE_WORTH_PENCE);

  let serviceLine: string | null = null;
  if (hasService && opts.serviceUsed) {
    const extras = others.slice(0, 2).map(inSentence);
    const plus = extras.length ? `, plus ${extras.join(" and ")}` : "";
    serviceLine = `You've had your service (worth ${worth})${plus}, all for ${pounds(opts.paidPence)}.`;
  } else if (hasService) {
    serviceLine = `Your annual service (worth ${worth}) hasn't been used yet. If you cancel now, you'll lose it.`;
  }

  const who = opts.engineerFirstName ? ` with ${opts.engineerFirstName}` : "";
  const loseLines = others.map((t) => (/^priority booking$/i.test(t) ? `${t}${who}` : t));
  return { paidPence: opts.paidPence, paidLine, serviceLine, loseLines };
}

// Servicing keeps warranties valid — not the plan itself (copy rule).
export const WARRANTY_LINE =
  "Most boiler manufacturers need a yearly service to keep your warranty valid, and a serviced boiler runs more efficiently.";
export const PASSPORT_FREEZE_LINE =
  "Your Home Passport will be frozen. No new service records will be added, and your home's history stops here when you sell.";

// UK outward code ("HD1 4AB" → "HD1") and area ("HD").
export function postcodeDistrict(postcode: string | null | undefined): string | null {
  const pc = (postcode ?? "").toUpperCase().replace(/\s+/g, "");
  if (pc.length < 2) return null;
  const outward = pc.length > 4 ? pc.slice(0, -3) : pc;
  return /^[A-Z]{1,2}\d[A-Z\d]?$/.test(outward) ? outward : null;
}
export function postcodeArea(postcode: string | null | undefined): string | null {
  return postcodeDistrict(postcode)?.match(/^[A-Z]+/)?.[0] ?? null;
}

// Is the new home somewhere this engineer works? Kept deliberately simple:
// the engineer's service-area text names the new district or postcode area
// ("HD1–HD9", "HD and WF postcodes"), or, with no service area written,
// the new home shares the engineer's own postcode area.
export function inEngineerArea(opts: {
  newPostcode: string;
  engineerPostcode: string | null;
  serviceArea: string | null;
}): boolean {
  const district = postcodeDistrict(opts.newPostcode);
  const area = postcodeArea(opts.newPostcode);
  if (!district || !area) return false;
  const text = (opts.serviceArea ?? "").toUpperCase();
  if (text.trim()) {
    const words = text.split(/[^A-Z0-9]+/).filter(Boolean);
    if (words.includes(district) || words.includes(area)) return true;
  }
  return postcodeArea(opts.engineerPostcode) === area;
}

// The next 1 October strictly after `after`.
export function nextWinterDate(after: Date): Date {
  const d = new Date(Date.UTC(after.getUTCFullYear(), WINTER_MONTH, 1, 9, 0, 0));
  if (d <= after) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

// Win-back offer, the engineer's choice (stored per engineer in AppSetting).
export const WINBACK_OFFERS = {
  none: "",
  first_month_free: "Rejoin and get your first month free",
} as const;
export type WinbackOffer = keyof typeof WINBACK_OFFERS;
export function winbackSettingKey(engineerId: string) {
  return `winback_offer:${engineerId}`;
}
export function parseWinbackOffer(raw: string | null | undefined): WinbackOffer {
  return raw === "first_month_free" ? "first_month_free" : "none";
}

export function winbackBody(opts: {
  firstName: string;
  brand: string;
  offer: WinbackOffer;
  link: string;
  winter: boolean;
}): string {
  const opener = opts.winter
    ? `Hi ${opts.firstName}, it's ${opts.brand}. Winter's on its way, the busiest time for boilers.`
    : `Hi ${opts.firstName}, it's ${opts.brand}. We miss looking after your boiler.`;
  const ask = opts.offer === "none" ? "Rejoin your care plan in one tap" : WINBACK_OFFERS[opts.offer];
  return `${opener} ${ask}: ${opts.link}`;
}

// Price rise notice — "what they've had for their money".
export function valueSummary(opts: { monthsOnPlan: number; servicesDone: number }): string {
  const months = `${opts.monthsOnPlan} month${opts.monthsOnPlan === 1 ? "" : "s"}`;
  const services =
    opts.servicesDone === 0
      ? "your annual service is still to come"
      : `you've had ${opts.servicesDone} service${opts.servicesDone === 1 ? "" : "s"}`;
  return `In ${months} on your plan, ${services}.`;
}

export function monthsBetween(from: Date, to: Date): number {
  const m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, to.getDate() < from.getDate() ? m - 1 : m);
}
