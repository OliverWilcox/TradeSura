// CONFIG (4 Oct notes 3.4): the example earnings shown on W0 and How it works
// are worked out from these, never typed as strings — update them when real
// average installer pricing comes in.
export const EXAMPLE_PLAN_PENCE = 1200; // a £12 a month plan
export const ENGINEER_SHARE = 0.8; // the engineer keeps 80%
export const EXAMPLE_CUSTOMERS = 10;

export const KEEP_PENCE_PER_CUSTOMER = Math.round(EXAMPLE_PLAN_PENCE * ENGINEER_SHARE); // 960

export function yearlyPence(customers: number): number {
  return customers * KEEP_PENCE_PER_CUSTOMER * 12;
}

// £1,152 / £9.60 — whole pounds drop the pence.
export function formatPounds(pence: number): string {
  const whole = pence % 100 === 0;
  return `£${(pence / 100).toLocaleString("en-GB", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}
