import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appFeeBasisPoints, getStripe, stripeConfigured } from "@/lib/stripe";
import { appFeePence } from "@/lib/clauses";

describe("20% app fee", () => {
  it("£15.00 → £3.00", () => expect(appFeePence(1500)).toBe(300));
  it("£9.00 → £1.80", () => expect(appFeePence(900)).toBe(180));
  it("rounds to nearest penny", () => expect(appFeePence(999)).toBe(200));
  it("maps to a Stripe application_fee_percent of 20", () =>
    expect(appFeeBasisPoints()).toBe(20));
});

describe("test-mode guard", () => {
  const original = process.env.STRIPE_SECRET_KEY;
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = original;
  });

  it("reports not configured without a key", () => {
    expect(stripeConfigured()).toBe(false);
  });

  it("refuses a live key — go-live is a human sign-off", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_deadbeef";
    expect(() => getStripe()).toThrow(/test mode/i);
  });

  it("accepts a test key", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_deadbeef";
    expect(() => getStripe()).not.toThrow();
  });
});
