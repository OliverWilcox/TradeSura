import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeApplicationFeePence, getStripe, stripeConfigured } from "@/lib/stripe";
import { appFeePence } from "@/lib/clauses";

describe("engineer-facing 20% fee estimate", () => {
  it("£15.00 → £3.00", () => expect(appFeePence(1500)).toBe(300));
  it("£9.00 → £1.80", () => expect(appFeePence(900)).toBe(180));
  it("rounds to nearest penny", () => expect(appFeePence(999)).toBe(200));
});

describe("real Stripe application_fee_amount: 20% + ~32p Bacs processing", () => {
  it("£12.00 invoice → £2.40 + 32p = £2.72 fee, engineer nets £9.28", () => {
    expect(computeApplicationFeePence(1200)).toBe(272);
    expect(1200 - computeApplicationFeePence(1200)).toBe(928);
  });
  it("£15.00 invoice → £3.00 + 32p = £3.32 fee, engineer nets £11.68", () => {
    expect(computeApplicationFeePence(1500)).toBe(332);
    expect(1500 - computeApplicationFeePence(1500)).toBe(1168);
  });
  it("rounds the percentage before adding the flat processing fee", () =>
    expect(computeApplicationFeePence(999)).toBe(232)); // round(999*0.2)=200, +32
});

// A full end-to-end proof (create a connected Express account + subscription
// + invoice against real Stripe test-mode objects, confirm the webhook sets
// application_fee_amount + transfer_data on the draft invoice before it
// finalizes) needs real sandbox keys, which this environment doesn't have —
// see the project's Stripe sandbox provisioning note. The arithmetic above
// is what's verifiable here; run the full loop once STRIPE_SECRET_KEY
// (sk_test_…) is set.

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
