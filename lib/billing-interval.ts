// Section 1 — plan payment rules that both the server and the customer's
// browser need. Pure maths only (no prisma, no Stripe) so client components
// can import it; lib/plan-billing.ts re-exports everything here.

export type BillingInterval = "month" | "year";

// "12 months for the price of 11".
export const YEARLY_MONTHS_CHARGED = 11;
export const COOLING_OFF_DAYS = 14;
// The annual service can be booked once the 3rd monthly payment clears.
export const ANNUAL_SERVICE_AFTER_PAYMENTS = 3;

export const FIRST_PAYMENT_LINE = "First payment after your 14-day cooling-off period.";

export function billingIntervalOf(v: string | null | undefined): BillingInterval {
  return v === "year" ? "year" : "month";
}

export function yearlyPricePence(priceMonthlyPence: number): number {
  return priceMonthlyPence * YEARLY_MONTHS_CHARGED;
}

// What one collection takes: the monthly price, or a year at 11 months' price.
export function chargePence(priceMonthlyPence: number, interval: BillingInterval | string | null | undefined): number {
  return billingIntervalOf(interval) === "year" ? yearlyPricePence(priceMonthlyPence) : priceMonthlyPence;
}

export function coolingOffEnd(from: Date): Date {
  return new Date(from.getTime() + COOLING_OFF_DAYS * 24 * 60 * 60 * 1000);
}

export function poundsLabel(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

// "£12 a month", "£132 a year", "… including VAT" — the full price the
// customer pays, shown before the mandate (CLAUDE.md compliance 2).
export function priceLine(
  priceMonthlyPence: number,
  interval: BillingInterval | string | null | undefined,
  vatRegistered?: boolean | null,
): string {
  const yearly = billingIntervalOf(interval) === "year";
  const label = poundsLabel(chargePence(priceMonthlyPence, interval));
  return `${label} a ${yearly ? "year" : "month"}${vatRegistered ? " including VAT" : ""}`;
}

// Calendar months, clamped so 31 Jan + 1 month is 28/29 Feb, not 3 March.
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

// Yearly plans: the month in progress counts as used, so the customer keeps
// benefits to the end of it and gets the remaining whole months back.
export function usedYearlyMonths(periodStart: Date, at: Date): number {
  let used = 1;
  while (used < 12 && addMonths(periodStart, used) < at) used++;
  return used;
}

export function unusedYearlyMonths(periodStart: Date, at: Date): number {
  return 12 - usedYearlyMonths(periodStart, at);
}

// Pro rata of what was actually paid (11 months' price covers 12 months).
export function yearlyRefundPence(amountPaidPence: number, unusedMonths: number): number {
  const months = Math.max(0, Math.min(12, unusedMonths));
  return Math.round((amountPaidPence * months) / 12);
}
