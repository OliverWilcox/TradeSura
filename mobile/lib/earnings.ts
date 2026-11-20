// CONFIG (4 Oct notes 3.4): the example earnings shown on W0 and How it works
// are worked out from these, never typed as strings. Matt 13 Nov: match the
// member pack letter everywhere — 20 customers at £15 a month = £2,880 a year,
// always labelled as an example.
export const EXAMPLE_PLAN_PENCE = 1500; // a £15 a month plan
export const ENGINEER_SHARE = 0.8; // the engineer keeps 80%
export const EXAMPLE_CUSTOMERS = 20;

export const KEEP_PENCE_PER_CUSTOMER = Math.round(EXAMPLE_PLAN_PENCE * ENGINEER_SHARE); // 1200

export function yearlyPence(customers: number): number {
  return customers * KEEP_PENCE_PER_CUSTOMER * 12;
}

// £2,880 / £9.60 — whole pounds drop the pence.
export function formatPounds(pence: number): string {
  const whole = pence % 100 === 0;
  return `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}
