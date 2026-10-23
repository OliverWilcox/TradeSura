// Stripe's point 7 — when Stripe asks a finished account for more
// information later, the engineer is alerted once and sent back to Get paid.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  alertedAt: null as Date | null,
  push: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
  email: vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: {
      update: vi.fn(async ({ data }) => {
        m.alertedAt = data.stripeMoreInfoAlertedAt;
      }),
      updateMany: vi.fn(async ({ data }) => {
        if (m.alertedAt) return { count: 0 };
        m.alertedAt = data.stripeMoreInfoAlertedAt;
        return { count: 1 };
      }),
    },
  },
}));
vi.mock("@/lib/track", () => ({ track: vi.fn(async () => undefined) }));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));
vi.mock("@/lib/stripe", () => ({}));

import { alertIfStripeNeedsMore } from "@/lib/stripe-onboarding";

const engineer = (finished: boolean) => ({
  id: "eng1",
  email: "eng@example.com",
  firstName: "Dave",
  stripeDetailsSubmitted: finished,
  stripeMoreInfoAlertedAt: m.alertedAt,
});
const status = (requirementsDue: boolean) => ({
  detailsSubmitted: true,
  chargesEnabled: !requirementsDue,
  payoutsEnabled: !requirementsDue,
  requirementsDue,
});

beforeEach(() => {
  m.alertedAt = null;
  m.push.mockClear();
  m.email.mockClear();
});

describe("alertIfStripeNeedsMore", () => {
  it("alerts once by push and email, pointing at Get paid", async () => {
    await alertIfStripeNeedsMore(engineer(true), status(true));
    await alertIfStripeNeedsMore(engineer(true), status(true));
    expect(m.push).toHaveBeenCalledTimes(1);
    expect(m.push.mock.calls[0][1]).toBe("Stripe needs one more thing");
    expect(m.push.mock.calls[0][3]).toEqual({ url: "/get-paid" });
    expect(m.email).toHaveBeenCalledTimes(1);
  });

  it("alerts again for a new request once the last one was done", async () => {
    await alertIfStripeNeedsMore(engineer(true), status(true));
    await alertIfStripeNeedsMore(engineer(true), status(false));
    expect(m.alertedAt).toBeNull();
    await alertIfStripeNeedsMore(engineer(true), status(true));
    expect(m.push).toHaveBeenCalledTimes(2);
  });

  it("stays quiet while the engineer is still mid-onboarding", async () => {
    await alertIfStripeNeedsMore(engineer(false), { ...status(true), detailsSubmitted: false });
    expect(m.push).not.toHaveBeenCalled();
  });
});
