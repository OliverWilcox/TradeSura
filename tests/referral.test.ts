import { describe, expect, it } from "vitest";
import { referralCommission, referralRatePercent } from "@/lib/referral";

// Build Review 2, ruling 4 — 25% of TradeSura's fee for the referred
// engineer's first 12 months, then 10% for life.
describe("referral commission", () => {
  const joined = new Date("2026-01-15T10:00:00Z");

  it("pays 25% inside the first 12 months", () => {
    expect(referralRatePercent(joined, new Date("2026-06-01T00:00:00Z"))).toBe(25);
    expect(referralRatePercent(joined, new Date("2027-01-15T09:59:00Z"))).toBe(25);
  });

  it("drops to 10% from the 12-month anniversary, for life", () => {
    expect(referralRatePercent(joined, new Date("2027-01-15T10:00:00Z"))).toBe(10);
    expect(referralRatePercent(joined, new Date("2035-01-01T00:00:00Z"))).toBe(10);
  });

  it("takes the share of the 20% fee, not of the whole collection", () => {
    // £12 plan: fee £2.40, 25% of that is 60p; 10% is 24p.
    expect(referralCommission(1200, 25)).toEqual({ feePence: 240, amountPence: 60 });
    expect(referralCommission(1200, 10)).toEqual({ feePence: 240, amountPence: 24 });
  });
});
