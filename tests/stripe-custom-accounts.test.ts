// Matt, 12 Nov — "the engineer never sees Stripe": new engineers get accounts
// TradeSura collects details for (Custom), set up in Stripe's form inside the
// app with Stripe's own sign-in switched off. STRIPE_CUSTOM_ACCOUNTS=0 goes
// back to Express for new accounts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: "acct_new" })),
  retrieve: vi.fn(),
  sessions: vi.fn(async () => ({ client_secret: "cs_123" })),
  balance: vi.fn(async () => ({})),
}));

vi.mock("stripe", () => {
  class StripeError extends Error {}
  class StripeInvalidRequestError extends StripeError {}
  class FakeStripe {
    static errors = { StripeError, StripeInvalidRequestError };
    v2 = { core: { accounts: { create: m.create, retrieve: m.retrieve, persons: { create: vi.fn() } } } };
    accountSessions = { create: m.sessions };
    balanceSettings = { update: m.balance };
  }
  return { default: FakeStripe };
});

import { createOnboardingSession, customAccountsOn, getOrCreateConnectAccount, platformCollectsDetails } from "@/lib/stripe";

const engineer = { id: "e1", email: "e@example.com", slug: "smith-heating", businessType: "sole_trader", tradingName: "Smith Heating", stripeAccountId: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.stubEnv("STRIPE_CUSTOM_ACCOUNTS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("new engineer accounts", () => {
  it("are Custom by default: no Stripe Dashboard, losses and fees on TradeSura", async () => {
    expect(customAccountsOn()).toBe(true);
    await getOrCreateConnectAccount(engineer);
    expect(m.create).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboard: "none",
        defaults: expect.objectContaining({ responsibilities: { fees_collector: "application", losses_collector: "application" } }),
      }),
    );
  });

  it("go back to Express when switched off", async () => {
    vi.stubEnv("STRIPE_CUSTOM_ACCOUNTS", "0");
    await getOrCreateConnectAccount(engineer);
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ dashboard: "express" }));
  });
});

describe("the in-app form", () => {
  it("opens with Stripe's sign-in switched off", async () => {
    expect(await createOnboardingSession("acct_new")).toBe("cs_123");
    expect(m.sessions).toHaveBeenCalledWith({
      account: "acct_new",
      components: {
        account_onboarding: { enabled: true, features: { disable_stripe_user_authentication: true, external_account_collection: true } },
      },
    });
  });

  it("is only for accounts TradeSura collects details for", async () => {
    m.retrieve.mockResolvedValueOnce({ defaults: { responsibilities: { requirements_collector: "application" } } });
    expect(await platformCollectsDetails("acct_new")).toBe(true);
    m.retrieve.mockResolvedValueOnce({ defaults: { responsibilities: { requirements_collector: "stripe" } } });
    expect(await platformCollectsDetails("acct_old")).toBe(false);
  });
});
