// Review 4 — 30 days' notice before a yearly plan renews, with the amount,
// the date and how to cancel; once per renewal.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  plans: [] as Record<string, unknown>[],
  events: [] as { name: string; meta: Record<string, unknown> }[],
  sms: vi.fn(async () => ({ sent: true })),
  email: vi.fn(async () => undefined),
  sub: null as Record<string, unknown> | null,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    plan: { findMany: async () => m.plans },
    event: {
      findFirst: async ({ where }: { where: { AND: { meta: { equals: string } }[] } }) => {
        const [planId, renewsOn] = where.AND.map((c) => c.meta.equals);
        return m.events.find((e) => e.meta.planId === planId && e.meta.renewsOn === renewsOn) ?? null;
      },
    },
  },
}));
vi.mock("@/lib/track", () => ({
  track: async (name: string, _a: unknown, meta: Record<string, unknown>) => {
    m.events.push({ name, meta });
  },
}));
vi.mock("@/lib/sms", () => ({ sendSms: m.sms }));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { retrieve: async () => m.sub } }),
}));

import { nextYearlyRenewal, renewalNoticeDue, sendYearlyRenewalNotices } from "@/lib/yearly-renewals";

const day = (s: string) => new Date(`${s}T09:00:00Z`);

function plan(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    ref: "TSH-1",
    engineerId: "e1",
    portalToken: "tok",
    billingInterval: "year",
    status: "ACTIVE",
    priceMonthlyPence: 1500,
    coolingOffEndsAt: day("2025-12-10"),
    activatedAt: day("2025-11-26"),
    stripeSubscriptionId: null,
    customer: { firstName: "Pat", phone: "+447700900222", email: "pat@example.com" },
    engineer: { tradingName: "Smith Heating", email: "dave@example.com", slug: "smith" },
    tier: { name: "Care" },
    ...over,
  };
}

beforeEach(() => {
  m.plans = [];
  m.events = [];
  m.sub = null;
  m.sms.mockClear();
  m.email.mockClear();
});

describe("renewal dates", () => {
  it("renews on each anniversary of the first collection", () => {
    expect(nextYearlyRenewal(day("2025-12-10"), day("2026-11-15")).toISOString().slice(0, 10)).toBe("2026-12-10");
    expect(nextYearlyRenewal(day("2025-12-10"), day("2026-12-11")).toISOString().slice(0, 10)).toBe("2027-12-10");
  });
  it("is due from 30 days before, not after the renewal", () => {
    expect(renewalNoticeDue(day("2026-12-10"), day("2026-11-09"))).toBe(false);
    expect(renewalNoticeDue(day("2026-12-10"), day("2026-11-10"))).toBe(true);
    expect(renewalNoticeDue(day("2026-12-10"), day("2026-12-11"))).toBe(false);
  });
});

describe("sendYearlyRenewalNotices", () => {
  it("texts and emails the amount, date and cancel link once", async () => {
    m.plans = [plan()];
    expect(await sendYearlyRenewalNotices(day("2026-11-12"))).toBe(1);
    expect(await sendYearlyRenewalNotices(day("2026-11-13"))).toBe(0);
    expect(m.sms).toHaveBeenCalledTimes(1);
    const body = (m.sms.mock.calls[0] as unknown as [{ body: string; messageClass: string }])[0];
    expect(body.messageClass).toBe("TRANSACTIONAL");
    expect(body.body).toContain("renews on 10 December 2026");
    expect(body.body).toContain("£165");
    expect(body.body).toContain("/portal/tok/manage");
    expect(m.email).toHaveBeenCalledTimes(1);
  });

  it("waits until 30 days before", async () => {
    m.plans = [plan()];
    expect(await sendYearlyRenewalNotices(day("2026-10-20"))).toBe(0);
  });

  it("uses Stripe's date and amount, and skips a plan already set to end", async () => {
    m.plans = [plan({ stripeSubscriptionId: "sub_1" })];
    m.sub = {
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      items: { data: [{ current_period_end: day("2026-12-12").getTime() / 1000, price: { unit_amount: 17600 }, quantity: 1 }] },
    };
    await sendYearlyRenewalNotices(day("2026-11-15"));
    const body = (m.sms.mock.calls[0] as unknown as [{ body: string }])[0].body;
    expect(body).toContain("12 December 2026");
    expect(body).toContain("£176");

    m.events = [];
    m.sms.mockClear();
    m.sub = { ...m.sub, cancel_at: 123 };
    expect(await sendYearlyRenewalNotices(day("2026-11-15"))).toBe(0);
  });
});
