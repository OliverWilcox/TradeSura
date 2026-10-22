// Retention spec §1 — the subscription is created with the first collection
// after the 14-day cooling-off, monthly or yearly, still a destination
// charge on behalf of the engineer.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  customers: { create: vi.fn(async () => ({ id: "cus_1" })) },
  prices: { create: vi.fn(async () => ({ id: "price_1" })) },
  subscriptions: {
    create: vi.fn(async () => ({
      id: "sub_1",
      pending_setup_intent: { id: "seti_1", client_secret: "seti_1_secret_x" },
      latest_invoice: null,
    })),
  },
  setupIntents: { update: vi.fn(async () => ({})) },
}));
vi.mock("stripe", () => {
  class Stripe {
    customers = s.customers;
    prices = s.prices;
    subscriptions = s.subscriptions;
    setupIntents = s.setupIntents;
    static errors = {};
  }
  return { default: Stripe };
});

import { createEmbeddedSubscription } from "@/lib/stripe";

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
};

describe("createEmbeddedSubscription", () => {
  it("monthly: no collection until 14 days from now; mandate set up via SetupIntent", async () => {
    const before = Date.now();
    const out = await createEmbeddedSubscription(base);
    const params = (s.subscriptions.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    const trialEnd = (params.trial_end as number) * 1000;
    expect(trialEnd - before).toBeGreaterThanOrEqual(14 * 86400000 - 2000);
    expect(trialEnd - before).toBeLessThan(14 * 86400000 + 5000);
    expect(params.trial_settings).toEqual({ end_behavior: { missing_payment_method: "cancel" } });
    expect(params.on_behalf_of).toBe("acct_eng");
    expect(params.transfer_data).toEqual({ destination: "acct_eng" });
    expect(params).not.toHaveProperty("application_fee_percent");
    expect(out.clientSecret).toBe("seti_1_secret_x");
    expect(s.setupIntents.update).toHaveBeenCalledWith("seti_1", { metadata: { planId: "plan_1", purpose: "signup" } });
    expect((s.prices.create.mock.calls[0] as unknown[])[0]).toMatchObject({ unit_amount: 1200, recurring: { interval: "month" } });
  });

  it("yearly: one collection of 11 months' price for the year", async () => {
    s.prices.create.mockClear();
    await createEmbeddedSubscription({ ...base, billingInterval: "year" });
    expect((s.prices.create.mock.calls[0] as unknown[])[0]).toMatchObject({ unit_amount: 13200, recurring: { interval: "year" } });
  });
});
