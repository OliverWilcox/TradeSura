// 30 Oct update §7.3 — "Worth over £X a year… just £Y a week." The value
// comes only from what the installer told us they normally charge (§5: blank
// inputs in the plan builder), never a guide price or a benchmark. Pure maths
// so the customer page and tests share it.
import { chargePence, type BillingInterval } from "@/lib/billing-interval";

export type NormalPrices = {
  normalServicePence: number | null;
  normalCalloutPence: number | null;
};

// Which plan lines a normal price stands for. A plan without the annual
// service (or with no call-out waiver) gets no value for it.
const SERVICE_CODE = "ANNUAL_SERVICE";
const CALLOUT_CODE = "NO_CALLOUT_FEE";

/** What the plan's items would cost a year at the installer's own prices (pence). */
export function planValuePence(codes: string[], prices: NormalPrices): number {
  let total = 0;
  if (codes.includes(SERVICE_CODE) && prices.normalServicePence) total += prices.normalServicePence;
  if (codes.includes(CALLOUT_CODE) && prices.normalCalloutPence) total += prices.normalCalloutPence;
  return total;
}

export type ValueSum = { overPounds: number; perWeek: string };

/**
 * The sum the page shows, or null when there's nothing honest to say: no
 * figures yet, or the plan costs more a year than its items' value, where
 * "worth over" would invite a comparison the plan loses.
 * "Over" is the value rounded down to a whole £10 below it, so it stays true.
 */
export function valueSum(
  codes: string[],
  prices: NormalPrices,
  priceMonthlyPence: number,
  interval: BillingInterval = "month",
): ValueSum | null {
  const value = planValuePence(codes, prices);
  const yearly = interval === "year" ? chargePence(priceMonthlyPence, "year") : priceMonthlyPence * 12;
  if (value <= 0 || value <= yearly) return null;
  const overPounds = Math.floor((value - 1) / 1000) * 10;
  if (overPounds * 100 <= yearly) return null;
  // Rounded up to the penny, so "just £Y a week" never understates the cost.
  const weekPence = Math.ceil(yearly / 52);
  return { overPounds, perWeek: `£${(weekPence / 100).toFixed(2)}` };
}
