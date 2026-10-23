import { billingIntervalOf, chargePence } from "@/lib/billing-interval";
import { TRADESURA_FEE_RATE } from "@/lib/clauses";

// Review 3 §3 — what one customer is worth a year to the engineer: each
// collection less TradeSura's 20% (rounded down, as Stripe's application fee
// is — lib/stripe.ts computeApplicationFeePence).
export function firstMemberYearlyPence(priceMonthlyPence: number, interval: string | null | undefined): number {
  const charge = chargePence(priceMonthlyPence, interval);
  const toEngineer = charge - Math.floor(charge * TRADESURA_FEE_RATE);
  return billingIntervalOf(interval) === "year" ? toEngineer : toEngineer * 12;
}

/** The deep link the app opens for the celebration (push + Home). */
export function firstCustomerPath(m: { customerFirstName: string; planName: string; yearlyPence: number; planId: string }): string {
  const q = new URLSearchParams({
    name: m.customerFirstName,
    plan: m.planName,
    yearlyPence: String(m.yearlyPence),
    planId: m.planId,
  });
  return `/first-customer?${q.toString()}`;
}
