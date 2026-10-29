import { describe, expect, it } from "vitest";
import { yearlyTermsLines } from "@/lib/billing-interval";

// Review 4 / engineer terms 6.6 — shown before the customer picks Pay yearly.
describe("yearly terms on the plan page", () => {
  it("states the annual price, the monthly comparison and the saving", () => {
    const [price] = yearlyTermsLines(2099);
    expect(price).toContain("£230.89 a year");
    expect(price).toContain("£251.88");
    expect(price).toContain("save £20.99");
  });
  it("says how a refund works on cancelling", () => {
    expect(yearlyTermsLines(1600)[1]).toMatch(/whole months you haven't used, in proportion to what you paid/);
  });
  it("adds VAT wording for a VAT-registered engineer", () => {
    expect(yearlyTermsLines(1600, true)[0]).toContain("£176 a year including VAT");
  });
});
