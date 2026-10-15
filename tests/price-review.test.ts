import { describe, expect, it } from "vitest";
import { earliestNextReview, noticeEffectiveDate, priceReviewError } from "@/lib/price-review";

// Build Review 2, ruling 3 — at most once a year, 30 days' notice, optional cap.
describe("annual price review", () => {
  it("starts the new price 30 days after the notice", () => {
    const now = new Date("2026-10-13T09:00:00Z");
    expect(noticeEffectiveDate(now).toISOString()).toBe("2026-11-12T09:00:00.000Z");
  });

  it("allows one review a year, counted from signup or the last review", () => {
    const activatedAt = new Date("2026-01-10T00:00:00Z");
    expect(earliestNextReview({ activatedAt, lastEffectiveAt: null }).toISOString()).toBe(
      "2027-01-10T00:00:00.000Z",
    );
    const lastEffectiveAt = new Date("2027-02-01T00:00:00Z");
    expect(earliestNextReview({ activatedAt, lastEffectiveAt }).toISOString()).toBe(
      "2028-02-01T00:00:00.000Z",
    );
  });

  it("keeps the £10 floor", () => {
    expect(priceReviewError({ oldPence: 1200, newPence: 900, capPercent: null })).toMatch(/minimum/);
  });

  it("has no cap unless one is set", () => {
    expect(priceReviewError({ oldPence: 1200, newPence: 3000, capPercent: null })).toBeNull();
  });

  it("enforces the cap when set", () => {
    expect(priceReviewError({ oldPence: 1000, newPence: 1100, capPercent: 10 })).toBeNull();
    expect(priceReviewError({ oldPence: 1000, newPence: 1101, capPercent: 10 })).toMatch(/at most 10%/);
  });

  it("rejects a review to the same price", () => {
    expect(priceReviewError({ oldPence: 1200, newPence: 1200, capPercent: null })).toMatch(/already pay/);
  });
});
