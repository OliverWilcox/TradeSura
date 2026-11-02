// Review 4 (Matt's decision) — the CP12 follows the 3rd-payment rule like the
// annual service. At landlord sign-up the customer gives the date their
// current gas safety record is due; if that falls before the plan's own
// record becomes available, they're warned and can ask the engineer for a
// one-off CP12 at the engineer's normal price, so the property stays legal.
// Wording waits on James for the terms. Pure maths here (client-safe).
import { ANNUAL_SERVICE_AFTER_PAYMENTS, addMonths, coolingOffEnd } from "@/lib/billing-interval";

export const CP12_CODE = "CP12";

export function tierHasCp12(codes: string[]): boolean {
  return codes.includes(CP12_CODE);
}

/**
 * When a customer signing up today can first have the plan's CP12: the start
 * of their third paid plan month (first collection after the 14-day
 * cooling-off, then two more months), for monthly and yearly payers alike.
 */
export function cp12AvailableFrom(signupAt: Date): Date {
  return addMonths(coolingOffEnd(signupAt), ANNUAL_SERVICE_AFTER_PAYMENTS - 1);
}

/** Their current record runs out before the plan's own one is available. */
export function recordDueBeforeCover(dueAt: Date, signupAt: Date): boolean {
  return dueAt.getTime() < cp12AvailableFrom(signupAt).getTime();
}

// "2026-12-03" from a date input, read as a UK calendar day. A due date more
// than a year gone or over two years ahead is a typo, not a record.
export function parseRecordDue(value: unknown, now: Date): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  if (d.getTime() < now.getTime() - yearMs || d.getTime() > now.getTime() + 2 * yearMs) return null;
  return d;
}

export function cp12Date(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
}

// Customer-facing strings, kept together so James can approve them in one place.
export const CP12_COPY = {
  question: "When is your current gas safety record due?",
  hint: "It's the date on your current gas safety record (CP12).",
  warning: (due: string, from: string) =>
    `Your gas safety record is due on ${due}, before your plan's gas safety record is available (${from}, after your third payment). A let property needs a valid record at all times, so you'll need one before then.`,
  offer: (engineer: string, due: string) =>
    `Ask ${engineer} to do a one-off gas safety record before ${due}, at their normal price. You pay them for it directly; it isn't part of your plan payments.`,
} as const;
