// Retention spec §1 and §3 — plan rules, yearly maths and the billing
// operations in lib/plan-billing.ts, with Stripe and the database mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  plan: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  planTier: { findFirst: vi.fn() },
  stripe: {
    subscriptions: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
    invoices: { list: vi.fn(), pay: vi.fn() },
    invoicePayments: { list: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    refunds: { create: vi.fn() },
    prices: { create: vi.fn() },
  },
  sendSms: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { plan: m.plan, planTier: m.planTier } }));
vi.mock("@/lib/stripe", async (orig) => ({
  ...(await orig<typeof import("@/lib/stripe")>()),
  getStripe: () => m.stripe,
}));
vi.mock("@/lib/sms", () => ({
  sendSms: m.sendSms,
  notifyEngineer: vi.fn(),
  cancelScheduledSms: vi.fn(),
  nextAllowedSendTime: (d: Date) => d,
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
vi.mock("@/lib/track", () => ({ track: vi.fn() }));
vi.mock("@/lib/activate", () => ({ activatePlan: vi.fn() }));

import {
  addMonths,
  annualServiceFrom,
  annualServiceUnlocked,
  cancelAtPeriodEnd,
  chargePence,
  pausePlan,
  paymentOutstanding,
  priceLine,
  recordClearedPayment,
  rescueCodeCandidate,
  rescueTextBody,
  startPaymentRescue,
  ukPhoneDisplay,
  undoCancel,
  unusedYearlyMonths,
  usedYearlyMonths,
  yearlyPricePence,
  yearlyRefundPence,
} from "@/lib/plan-billing";
import { computeApplicationFeePence } from "@/lib/stripe";

const DAY = 24 * 60 * 60 * 1000;
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

describe("annual service unlocks after the 3rd payment", () => {
  it("monthly: locked at 0–2, open from 3", () => {
    expect(annualServiceUnlocked({ paymentsCleared: 0 })).toBe(false);
    expect(annualServiceUnlocked({ paymentsCleared: 2 })).toBe(false);
    expect(annualServiceUnlocked({ paymentsCleared: 3 })).toBe(true);
  });
  it("yearly: from the start of the third paid plan month (customer terms 5.2)", () => {
    const yearly = { billingInterval: "year", coolingOffEndsAt: new Date("2026-11-10T12:00:00Z"), activatedAt: null };
    expect(annualServiceUnlocked({ ...yearly, paymentsCleared: 0 }, new Date("2027-02-01T12:00:00Z"))).toBe(false);
    expect(annualServiceUnlocked({ ...yearly, paymentsCleared: 1 }, new Date("2026-12-01T12:00:00Z"))).toBe(false);
    expect(annualServiceUnlocked({ ...yearly, paymentsCleared: 1 }, new Date("2027-01-09T12:00:00Z"))).toBe(false);
    expect(annualServiceUnlocked({ ...yearly, paymentsCleared: 1 }, new Date("2027-01-10T12:00:00Z"))).toBe(true);
  });
});

describe("when the annual service opens (portal)", () => {
  const coolingOffEndsAt = new Date("2026-11-10T12:00:00Z");
  it("monthly: the month of the 3rd collection, not a year after joining", () => {
    const d = annualServiceFrom({ coolingOffEndsAt, activatedAt: new Date("2026-10-27T12:00:00Z") });
    expect(d?.toISOString().slice(0, 10)).toBe("2027-01-10");
  });
  it("yearly: the start of the third paid plan month, same as monthly", () => {
    const d = annualServiceFrom({ coolingOffEndsAt, activatedAt: null, billingInterval: "year" });
    expect(d?.toISOString().slice(0, 10)).toBe("2027-01-10");
  });
  it("falls back to 14 days after activation", () => {
    const d = annualServiceFrom({ coolingOffEndsAt: null, activatedAt: new Date("2026-10-27T12:00:00Z") });
    expect(d?.toISOString().slice(0, 7)).toBe("2027-01");
  });
});

describe("payment outstanding", () => {
  it("only while a failure hasn't cleared", () => {
    expect(paymentOutstanding({ paymentFailedAt: null })).toBe(false);
    expect(paymentOutstanding({ paymentFailedAt: new Date() })).toBe(true);
  });
});

describe("yearly: 12 months for the price of 11", () => {
  it("£12 a month → £132 a year", () => {
    expect(yearlyPricePence(1200)).toBe(13200);
    expect(chargePence(1200, "year")).toBe(13200);
    expect(chargePence(1200, "month")).toBe(1200);
    expect(priceLine(1200, "year")).toBe("£132 a year");
    expect(priceLine(1599, "month", true)).toBe("£15.99 a month including VAT");
  });
  it("our fee is 20% of the yearly amount, rounded down", () => {
    expect(computeApplicationFeePence(yearlyPricePence(1200))).toBe(2640);
    expect(computeApplicationFeePence(yearlyPricePence(1599))).toBe(3517); // 17589 × 0.2 = 3517.8
  });
});

describe("yearly refunds: unused whole months, pro rata", () => {
  const start = new Date(2026, 0, 15);
  it("the month in progress counts as used", () => {
    expect(usedYearlyMonths(start, new Date(2026, 0, 16))).toBe(1);
    expect(usedYearlyMonths(start, new Date(2026, 1, 15))).toBe(1);
    expect(usedYearlyMonths(start, new Date(2026, 1, 16))).toBe(2);
    expect(unusedYearlyMonths(start, new Date(2026, 4, 20))).toBe(7);
    expect(unusedYearlyMonths(start, new Date(2027, 0, 14))).toBe(0);
  });
  it("refund is that share of what was paid", () => {
    expect(yearlyRefundPence(13200, 7)).toBe(7700);
    expect(yearlyRefundPence(13200, 0)).toBe(0);
    expect(yearlyRefundPence(13200, 12)).toBe(13200);
  });
  it("month arithmetic clamps to the end of short months", () => {
    const d = addMonths(new Date(2026, 0, 31), 1);
    expect([d.getMonth(), d.getDate()]).toEqual([1, 28]);
  });
});

describe("rescue text", () => {
  it("matches the spec's wording, sent as the engineer", () => {
    const body = rescueTextBody({
      customerFirstName: "Sarah",
      amountPence: 1200,
      brand: "Dave's Heating",
      link: "https://tradesura.com/u/7QX2",
      engineerFirstName: "Dave",
      engineerPhone: "07700 900123",
    });
    expect(body).toContain("Hi Sarah, your £12 payment to Dave's Heating didn't go through.");
    expect(body).toContain("Update your bank details in one tap and your plan carries on as normal: https://tradesura.com/u/7QX2");
    expect(body).toContain("Any questions, just call Dave on 07700 900123.");
    expect(body).not.toMatch(/protection|cover|breakdown|guarantee/i);
  });
  it("codes are short and unambiguous", () => {
    for (let i = 0; i < 50; i++) expect(rescueCodeCandidate()).toMatch(/^[2-9A-HJKMNP-Z]{4}$/);
  });
  it("formats UK numbers for reading", () => expect(ukPhoneDisplay("+447700900123")).toBe("07700 900123"));
});

const basePlan = {
  id: "plan_1",
  engineerId: "eng_1",
  customerId: "cus_1",
  status: "ACTIVE",
  stripeSubscriptionId: "sub_1",
  billingInterval: "month",
  coolingOffEndsAt: new Date(Date.now() - 30 * DAY),
  cancelRequestedAt: null,
  cancelEffectiveAt: null,
  paymentFailedAt: null,
  serviceStartsAt: null,
  paymentsCleared: 0,
  rescueCode: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.plan.update.mockResolvedValue({});
  m.plan.findUnique.mockResolvedValue(null);
});

describe("cancelAtPeriodEnd", () => {
  it("monthly: Stripe cancels at the end of the paid month", async () => {
    const end = new Date(Date.now() + 10 * DAY);
    m.plan.findUniqueOrThrow.mockResolvedValue(basePlan);
    m.stripe.subscriptions.retrieve.mockResolvedValue({ id: "sub_1", status: "active", items: { data: [] } });
    m.stripe.subscriptions.update.mockResolvedValue({ cancel_at: sec(end), items: { data: [] } });
    const { effectiveAt } = await cancelAtPeriodEnd("plan_1");
    expect(m.stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(m.stripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(sec(effectiveAt)).toBe(sec(end));
    expect(m.plan.update.mock.calls[0][0].data).toMatchObject({ cancelEffectiveAt: effectiveAt });
  });

  it("in cooling-off: ends now, nothing taken, nothing to refund", async () => {
    m.plan.findUniqueOrThrow.mockResolvedValue({ ...basePlan, coolingOffEndsAt: new Date(Date.now() + 5 * DAY) });
    m.stripe.subscriptions.retrieve.mockResolvedValue({ id: "sub_1", status: "trialing", items: { data: [] } });
    m.stripe.invoices.list.mockResolvedValue({ data: [] });
    const { effectiveAt } = await cancelAtPeriodEnd("plan_1");
    expect(m.stripe.subscriptions.cancel).toHaveBeenCalledWith("sub_1");
    expect(m.stripe.refunds.create).not.toHaveBeenCalled();
    expect(Math.abs(effectiveAt.getTime() - Date.now())).toBeLessThan(5000);
    expect(m.plan.update.mock.calls[0][0].data).toMatchObject({ status: "CANCELLED" });
  });

  it("yearly: ends at the end of the month in progress, no proration", async () => {
    const start = new Date(Date.now() - 40 * DAY);
    const periodEnd = addMonths(start, 12);
    m.plan.findUniqueOrThrow.mockResolvedValue({ ...basePlan, billingInterval: "year" });
    m.stripe.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      status: "active",
      items: { data: [{ current_period_start: sec(start), current_period_end: sec(periodEnd) }] },
    });
    m.stripe.subscriptions.update.mockImplementation(async (_id, p) => ({ cancel_at: p.cancel_at }));
    const { effectiveAt } = await cancelAtPeriodEnd("plan_1");
    const params = m.stripe.subscriptions.update.mock.calls[0][1];
    expect(params.proration_behavior).toBe("none");
    expect(sec(effectiveAt)).toBe(sec(addMonths(new Date(start.getTime()), 2)));
  });
});

describe("undoCancel", () => {
  it("clears a scheduled monthly cancel", async () => {
    m.plan.findUniqueOrThrow.mockResolvedValue({ ...basePlan, cancelRequestedAt: new Date() });
    m.stripe.subscriptions.retrieve.mockResolvedValue({ id: "sub_1", status: "active", cancel_at_period_end: true });
    await undoCancel("plan_1");
    expect(m.stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: false });
    expect(m.plan.update.mock.calls[0][0].data).toEqual({ cancelRequestedAt: null, cancelEffectiveAt: null });
  });
});

describe("pausePlan", () => {
  it("voids collections until resumes_at and marks the plan PAUSED", async () => {
    m.plan.findUniqueOrThrow.mockResolvedValue(basePlan);
    const { resumesAt } = await pausePlan("plan_1", 2);
    expect(m.stripe.subscriptions.update).toHaveBeenCalledWith("sub_1", {
      pause_collection: { behavior: "void", resumes_at: sec(resumesAt) },
    });
    expect(m.plan.update.mock.calls[0][0].data).toEqual({ status: "PAUSED", pausedUntil: resumesAt });
  });
});

describe("cleared payments", () => {
  it("first real payment sets the service start date and counts towards the service", async () => {
    m.plan.findUniqueOrThrow.mockResolvedValue(basePlan);
    await recordClearedPayment("plan_1", 1200);
    const data = m.plan.update.mock.calls[0][0].data;
    expect(data.paymentsCleared).toEqual({ increment: 1 });
    expect(data.serviceStartsAt).toBeInstanceOf(Date);
  });
  it("the £0 cooling-off invoice doesn't count", async () => {
    await recordClearedPayment("plan_1", 0);
    expect(m.plan.update).not.toHaveBeenCalled();
  });
  it("a payment after a failure is a rescue", async () => {
    m.plan.findUniqueOrThrow.mockResolvedValue({ ...basePlan, paymentFailedAt: new Date(Date.now() - 4 * DAY) });
    await recordClearedPayment("plan_1", 1200);
    const data = m.plan.update.mock.calls[0][0].data;
    expect(data.paymentFailedAt).toBeNull();
    expect(data.paymentRecoveredAt).toBeInstanceOf(Date);
  });
});

describe("startPaymentRescue", () => {
  it("texts now plus reminders on day 3 and 7, all cancellable as rescue:<planId>", async () => {
    m.plan.findUniqueOrThrow.mockResolvedValue({
      ...basePlan,
      customer: { firstName: "Sarah", lastName: "Jones", phone: "+447700900999", email: null },
      engineer: { tradingName: "Dave's Heating", slug: "daves", firstName: "Dave", gasSafeName: null, phone: "+447700900123", email: "d@example.com" },
    });
    await startPaymentRescue("plan_1", 1200);
    const keys = m.sendSms.mock.calls.map((c) => c[0].cancelKey);
    expect(keys).toEqual(["rescue:plan_1:0", "rescue:plan_1:3", "rescue:plan_1:7"]);
    expect(m.sendSms.mock.calls.every((c) => c[0].messageClass === "TRANSACTIONAL")).toBe(true);
    expect(m.plan.update.mock.calls[0][0].data.rescueCode).toMatch(/^[2-9A-Z]{4}$/);
  });
  it("doesn't re-text when Stripe's retry fails again", async () => {
    m.plan.findUniqueOrThrow.mockResolvedValue({ ...basePlan, paymentFailedAt: new Date(), customer: {}, engineer: {} });
    await startPaymentRescue("plan_1", 1200);
    expect(m.sendSms).not.toHaveBeenCalled();
  });
});
