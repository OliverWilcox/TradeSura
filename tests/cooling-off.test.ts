// Retention spec §1 — the subscription is created with the first collection
// after the 14-day cooling-off, monthly or yearly, still a destination
// charge on behalf of the engineer.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  customers: { create: vi.fn(async () => ({ id: "cus_1" })) },
  checkout: { sessions: { create: vi.fn(async () => ({ id: "cs_1", client_secret: "cs_1_secret_x" })) } },
}));
vi.mock("stripe", () => {
  class Stripe {
    customers = s.customers;
    checkout = s.checkout;
    static errors = {};
  }
  return { default: Stripe };
});

import { createSignupCheckout } from "@/lib/stripe";

const original = process.env.STRIPE_SECRET_KEY;
beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
});
afterAll(() => {
  if (original === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = original;
});

const base = {
  engineerAccountId: "acct_eng",
  priceMonthlyPence: 1200,
  productName: "Dave's Heating — Boiler Care care plan",
  customerName: "Sarah Jones",
  planId: "plan_1",
  planRef: "TSH-1234",
  returnUrl: "https://tradesura.com/p/x/signup/t/confirmed?cs={CHECKOUT_SESSION_ID}",
};

// The account can't make Bacs mandates with bare SetupIntents, so sign-up
// is an embedded Checkout that creates the subscription when it completes.
describe("createSignupCheckout", () => {
  type Params = {
    subscription_data: Record<string, unknown> & { trial_end: number };
    line_items: { price_data: Record<string, unknown> }[];
    customer: string;
  } & Record<string, unknown>;
  const call = () => (s.checkout.sessions.create.mock.calls.at(-1) as unknown[])[0] as Params;

  it("monthly: embedded Bacs Checkout, no collection until 14 days from now", async () => {
    const before = Date.now();
    const out = await createSignupCheckout(base);
    const params = call();
    expect(params).toMatchObject({
      mode: "subscription",
      ui_mode: "embedded_page",
      customer: "cus_1",
      payment_method_types: ["bacs_debit"],
      metadata: { planId: "plan_1", purpose: "signup" },
      return_url: base.returnUrl,
    });
    const sub = params.subscription_data;
    const trialEnd = sub.trial_end * 1000;
    expect(trialEnd - before).toBeGreaterThanOrEqual(14 * 86400000 - 2000);
    expect(trialEnd - before).toBeLessThan(14 * 86400000 + 5000);
    expect(sub.trial_settings).toEqual({ end_behavior: { missing_payment_method: "cancel" } });
    expect(sub.on_behalf_of).toBe("acct_eng");
    expect(sub.transfer_data).toEqual({ destination: "acct_eng" });
    expect(sub.metadata).toMatchObject({ planId: "plan_1", planRef: "TSH-1234", billingInterval: "month" });
    expect(sub).not.toHaveProperty("application_fee_percent");
    expect(params.line_items[0].price_data).toMatchObject({ unit_amount: 1200, recurring: { interval: "month" } });
    expect(out).toMatchObject({ sessionId: "cs_1", customerId: "cus_1", clientSecret: "cs_1_secret_x" });
  });

  it("yearly: one collection of 11 months' price for the year", async () => {
    await createSignupCheckout({ ...base, billingInterval: "year" });
    expect(call().line_items[0].price_data).toMatchObject({ unit_amount: 13200, recurring: { interval: "year" } });
  });

  it("reuses the customer's Stripe customer", async () => {
    s.customers.create.mockClear();
    await createSignupCheckout({ ...base, existingStripeCustomerId: "cus_old" });
    expect(s.customers.create).not.toHaveBeenCalled();
    expect(call().customer).toBe("cus_old");
  });
});
