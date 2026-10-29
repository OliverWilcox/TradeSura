import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeApplicationFeePence,
  getStripe,
  statementDescriptor,
  stripeConfigured,
  stripeSetupState,
} from "@/lib/stripe";
import { appFeePence } from "@/lib/clauses";

describe("engineer-facing 20% fee estimate", () => {
  it("£15.00 → £3.00", () => expect(appFeePence(1500)).toBe(300));
  it("£9.00 → £1.80", () => expect(appFeePence(900)).toBe(180));
  it("rounds down to the penny", () => expect(appFeePence(999)).toBe(199));
});

describe("real Stripe application_fee_amount: 20% rounded down, TradeSura pays processing", () => {
  it("£12.00 invoice → £2.40 fee, engineer keeps £9.60", () => {
    expect(computeApplicationFeePence(1200)).toBe(240);
    expect(1200 - computeApplicationFeePence(1200)).toBe(960);
  });
  it("£15.99 invoice → £3.19 fee, engineer keeps £12.80 (Build Review 3)", () => {
    expect(computeApplicationFeePence(1599)).toBe(319);
    expect(1599 - computeApplicationFeePence(1599)).toBe(1280);
  });
  it("never rounds up against the engineer", () => {
    expect(computeApplicationFeePence(999)).toBe(199); // 199.8 → 199
    expect(computeApplicationFeePence(1004)).toBe(200); // 200.8 → 200
  });
  it("matches the engineer-facing estimate", () => {
    for (const p of [1000, 1234, 1599, 2200, 99999]) {
      expect(computeApplicationFeePence(p)).toBe(appFeePence(p));
    }
  });
});

describe("statement descriptor = the engineer's trading name", () => {
  it("uppercases and keeps letters, numbers and spaces", () =>
    expect(statementDescriptor("MW Heating")).toBe("MW HEATING"));
  it("strips characters Stripe refuses", () =>
    expect(statementDescriptor(`O'Neill "Gas" <Co>*`)).toBe("ONEILL GAS CO"));
  it("caps at 22 characters", () =>
    expect(statementDescriptor("Smith & Sons Heating and Plumbing Ltd")).toBe("SMITH AND SONS HEATING"));
  it("falls back to the legal name when the trading name is too short", () =>
    expect(statementDescriptor("JB", "JB Gas Services Ltd")).toBe("JB GAS SERVICES LTD"));
  it("gives up rather than send something invalid", () => expect(statementDescriptor("12", null)).toBeUndefined());
});

describe("payment setup state", () => {
  const e = {
    stripeAccountId: "acct_1",
    stripeDetailsSubmitted: false,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
  };
  const live = { detailsSubmitted: true, chargesEnabled: false, payoutsEnabled: false, requirementsDue: false };
  it("none without an account", () => expect(stripeSetupState({ ...e, stripeAccountId: null })).toBe("none"));
  it("half when Stripe was left before the end", () => expect(stripeSetupState(e)).toBe("half"));
  it("none when Get paid made the account but Stripe was never opened", () =>
    expect(stripeSetupState({ ...e, stripeOnboardingStartedAt: null })).toBe("none"));
  it("half once the engineer has been to Stripe", () =>
    expect(stripeSetupState({ ...e, stripeOnboardingStartedAt: new Date() })).toBe("half"));
  it("needs_more when submitted but something is due", () =>
    expect(stripeSetupState({ ...e, stripeDetailsSubmitted: true }, { ...live, requirementsDue: true })).toBe(
      "needs_more",
    ));
  it("checking when submitted and nothing is due", () =>
    expect(stripeSetupState({ ...e, stripeDetailsSubmitted: true }, live)).toBe("checking"));
  it("ready when charges and payouts are on", () =>
    expect(
      stripeSetupState({ ...e, stripeDetailsSubmitted: true, stripeChargesEnabled: true, stripePayoutsEnabled: true }),
    ).toBe("ready"));
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
