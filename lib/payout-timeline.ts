import { coolingOffEnd } from "@/lib/billing-interval";

// Matt, 30 Oct §9.3 — "joins › 14-day cooling-off › first collection › about
// 3 working days for Bacs › Friday payout", with real dates. Payouts run
// weekly on Fridays (lib/stripe.ts setFridayPayouts). Stripe also holds a new
// account's money for about 7 days before its first payout (test-mode GB
// accounts show settlement delay_days 7), so a collection is paid out on the
// first Friday after BOTH the Bacs payment has cleared and the hold has run.
export const BACS_CLEAR_WORKING_DAYS = 3;
export const FIRST_PAYOUT_HOLD_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

// England and Wales bank holidays (gov.uk), so "3 working days" over
// Christmas is honest. Bacs doesn't run on them.
const BANK_HOLIDAYS = new Set([
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
]);

// Dates are whole UK days; working at midday UTC keeps them clear of the
// clock change.
function day(d: Date): Date {
  const x = new Date(d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }) + "T12:00:00Z");
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isWorkingDay = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !BANK_HOLIDAYS.has(iso(d));

export function addWorkingDays(from: Date, n: number): Date {
  let d = day(from);
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (isWorkingDay(d)) left -= 1;
  }
  return d;
}

/** The first Friday on or after this day. */
export function fridayOnOrAfter(from: Date): Date {
  const d = day(from);
  return new Date(d.getTime() + ((5 - d.getUTCDay() + 7) % 7) * DAY);
}

export type PayoutTimeline = {
  joinedAt: string;
  coolingOffEndsAt: string;
  firstCollectionAt: string;
  clearsAt: string;
  payoutAt: string;
};

/**
 * One customer's money, from joining to the engineer's bank. `firstCollectionAt`
 * is the plan's real first collection (Plan.coolingOffEndsAt) when known.
 * `holdDays` is Stripe's hold: FIRST_PAYOUT_HOLD_DAYS until the engineer's
 * first payout, 0 after (the weekly Friday run picks up what's cleared).
 * A payout date already in the past rolls on to the coming Friday.
 */
export function payoutTimeline(opts: {
  joinedAt: Date;
  firstCollectionAt?: Date | null;
  holdDays?: number;
  now?: Date;
}): PayoutTimeline {
  const joined = day(opts.joinedAt);
  const coolingOff = day(coolingOffEnd(opts.joinedAt));
  const collection = day(opts.firstCollectionAt ?? coolingOffEnd(opts.joinedAt));
  const clears = addWorkingDays(collection, BACS_CLEAR_WORKING_DAYS);
  const held = new Date(collection.getTime() + (opts.holdDays ?? FIRST_PAYOUT_HOLD_DAYS) * DAY);
  const today = day(opts.now ?? new Date());
  const ready = held > clears ? held : clears;
  let payout = fridayOnOrAfter(ready < today ? today : ready);
  // A bank-holiday Friday's payout reaches the bank the next working day.
  if (!isWorkingDay(payout)) payout = addWorkingDays(payout, 1);
  return {
    joinedAt: iso(joined),
    coolingOffEndsAt: iso(coolingOff),
    firstCollectionAt: iso(collection),
    clearsAt: iso(clears),
    payoutAt: iso(payout),
  };
}

/** "Fri 4 Dec" — how Home and the timeline show a date. */
export function shortDay(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
