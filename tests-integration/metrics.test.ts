import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as statsRoute } from "@/app/api/admin/v1/dashboard/stats/route";
import { GET as signupsRoute } from "@/app/api/admin/v1/dashboard/signups/route";
import { GET as funnelRoute } from "@/app/api/admin/v1/dashboard/funnel/route";
import { GET as moneyRoute } from "@/app/api/admin/v1/dashboard/money/route";
import { computeApplicationFeePence } from "@/lib/stripe";
import { customerStatus, deliveryOf, funnelOf, payments, testMarks, type Milestones } from "@/lib/admin/metrics";
import { call, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";
import { clientFixture, OCTOBER } from "./client-fixture";

// The client's dashboard of 31 October 2026, rebuilt (client-fixture.ts):
// every card, funnel step and list must tell the same story.

beforeEach(resetDb);

const steps = (body: { label: string; count: number }[]) => body.map((s) => [s.label, s.count]);

describe("the client's dashboard", () => {
  it("agrees with itself on every figure", async () => {
    await clientFixture();
    const [stats, funnel, signups, money] = await Promise.all([
      call(statsRoute, { query: OCTOBER }),
      call(funnelRoute, { query: OCTOBER }),
      call(signupsRoute, { query: OCTOBER }),
      call(moneyRoute, { query: OCTOBER }),
    ]);
    expect([stats.status, funnel.status, signups.status, money.status]).toEqual([200, 200, 200, 200]);

    // 2.3: a cohort, in the spec's order, each step inside the one before.
    expect(steps(funnel.body)).toEqual([
      ["Signed up", 4],
      ["Verified", 3],
      ["First plan live", 3],
      ["Payments set up", 2],
      ["First payment", 1],
    ]);
    for (const s of funnel.body) expect(s.fromPrevious).toBeLessThanOrEqual(1);

    // 2.4: the cards are the funnel's first steps; deleted, staff and test accounts count nowhere.
    expect(stats.body.signups).toBe(funnel.body[0].count);
    expect(stats.body.verified).toEqual({ ofSignups: funnel.body[1].count, total: 3 });
    expect(signups.body.byDay.reduce((n: number, d: { count: number }) => n + d.count, 0)).toBe(4);

    // 2.1 and 5.6: £12 collected is the first payment; the £0 trial invoices aren't payments.
    expect(money.body.period).toMatchObject({ count: 1, grossPence: 1200, netPence: 1200 });
    expect(funnel.body[4].count).toBe(1);

    // 2.6: TradeSura's 20 % of £12, as the app works it out.
    expect(money.body.period.feePence).toBe(240);
    expect(computeApplicationFeePence(1200)).toBe(240);

    // 2 plans live, 2 customers; 2.2: one engineer sent a delivered offer in the last 7 days.
    expect(stats.body).toMatchObject({ plansLive: 2, customers: 2, active: 1, activeWindowDays: 7 });

    // 2.5: the WhatsApp offer that never went isn't in the headline.
    expect(stats.body.offers).toEqual({ delivered: 2, failed: 0, unconfirmed: 1 });
    expect(stats.body.conversion).toEqual({ sent: 2, converted: 2, rate: 1 });

    // 2.7: the testers' "Letter" sign-ups are test data, so no letters.
    expect(signups.body.channels.map((c: { channel: string }) => c.channel)).not.toContain("letter");
  });

  it("leaves a test customer's plans and payments out, whoever their engineer is", async () => {
    const f = await clientFixture();
    await prisma.adminTestMark.create({ data: { subjectType: "customer", subjectId: f.oliver.id, adminId: "a", adminName: "A" } });
    const [stats, money] = await Promise.all([call(statsRoute, { query: OCTOBER }), call(moneyRoute, { query: OCTOBER })]);
    expect(stats.body).toMatchObject({ plansLive: 1, customers: 1 });
    expect(money.body.period.grossPence).toBe(0);
  });
});

describe("letters as a channel", () => {
  it("count only engineers who redeemed a letter's claim code", async () => {
    const coded = await makeEngineer({ createdAt: new Date("2026-10-10T09:00:00Z"), attribution: { heardVia: "letter" } });
    await makeEngineer({ createdAt: new Date("2026-10-11T09:00:00Z"), attribution: { heardVia: "letter" } });
    await prisma.claimCode.create({ data: { code: "TS-12345", firstName: "A", businessName: "B", letterBatch: "oct", variantCell: "A", redeemedByEngineerId: coded.id } });
    const res = await call(signupsRoute, { query: OCTOBER });
    expect(res.body.channels).toEqual([
      { channel: "letter", count: 1, share: 0.5 },
      { channel: "letter_unverified", count: 1, share: 0.5 },
    ]);
  });
});

describe("TradeSura's fee", () => {
  it("uses Stripe's fee where it was set and the app's helper where it wasn't", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id);
    await makePlan(e.id, c.id, { stripeSubscriptionId: "sub_1" });
    const invoice = (id: string, amount: number, fee: number | null) => ({
      id: `evt_${id}`,
      type: "invoice.paid",
      payload: { data: { object: { id, amount_paid: amount, application_fee_amount: fee, subscription: "sub_1", status_transitions: { paid_at: 1_793_000_000 } } } },
    });
    // A month with one fee recorded and one not: the old sum took only the first.
    await prisma.stripeWebhookEvent.createMany({ data: [invoice("in_a", 1000, 200), invoice("in_b", 1599, null)] });
    const ps = await payments(await testMarks());
    expect(ps.map((p) => p.feePence)).toEqual([200, 319]);
  });

  it("counts an invoice once however many times Stripe sent it", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id);
    await makePlan(e.id, c.id, { stripeSubscriptionId: "sub_1" });
    const object = { id: "in_a", amount_paid: 1000, application_fee_amount: 200, subscription: "sub_1", status_transitions: { paid_at: 1_793_000_000 } };
    await prisma.stripeWebhookEvent.createMany({ data: [1, 2].map((n) => ({ id: `evt_${n}`, type: "invoice.paid", payload: { data: { object } } })) });
    expect(await payments(await testMarks())).toHaveLength(1);
  });
});

describe("the funnel's steps", () => {
  const m = (reached: Partial<Record<keyof Milestones, boolean>>): Milestones => ({
    signed_up: { reached: true, at: null },
    verified: { reached: !!reached.verified, at: null },
    plan_live: { reached: !!reached.plan_live, at: null },
    payments_set_up: { reached: !!reached.payments_set_up, at: null },
    first_payment: { reached: !!reached.first_payment, at: null },
  });

  it("never let a step outgrow the one before", () => {
    // Plan live without payments set up, and payments without verification: the old 150 %.
    const all = [m({ verified: true, plan_live: true, payments_set_up: true }), m({ verified: true, plan_live: true }), m({ plan_live: true, payments_set_up: true })];
    const counts = funnelOf(all).map((s) => s.count);
    expect(counts).toEqual([3, 2, 2, 1, 0]);
  });

  it("follow whatever order they're given", () => {
    const all = [m({ payments_set_up: true }), m({ verified: true, payments_set_up: true })];
    expect(funnelOf(all, ["signed_up", "payments_set_up", "verified"]).map((s) => [s.key, s.count])).toEqual([
      ["signed_up", 2],
      ["payments_set_up", 2],
      ["verified", 1],
    ]);
  });
});

describe("an offer's delivery and a customer's status", () => {
  it("call a WhatsApp offer unconfirmed until its link is opened", () => {
    expect(deliveryOf({ channel: "whatsapp", openedAt: null })).toBe("unconfirmed");
    expect(deliveryOf({ channel: "whatsapp", openedAt: new Date() })).toBe("delivered");
    expect(deliveryOf({ channel: "sms", openedAt: null })).toBe("delivered");
    expect(deliveryOf({ channel: "sms", openedAt: null, failedAt: new Date() })).toBe("failed");
  });

  it("follow a customer from the offer to the end", () => {
    const plan = { status: "PENDING" as const, mandateStatus: null, priceMonthlyPence: null, linkOpenedAt: null, paymentFailedAt: null, paymentRecoveredAt: null };
    const unpaid = { offer: { delivery: "delivered" as const }, paid: false };
    expect(customerStatus(null, unpaid)).toBe("no_plan");
    expect(customerStatus(plan, { offer: { delivery: "unconfirmed" }, paid: false })).toBe("offer_unconfirmed");
    expect(customerStatus(plan, unpaid)).toBe("offer_sent");
    expect(customerStatus({ ...plan, linkOpenedAt: new Date() }, unpaid)).toBe("offer_opened");
    expect(customerStatus({ ...plan, linkOpenedAt: new Date(), priceMonthlyPence: 1500, mandateStatus: "pending" }, unpaid)).toBe("thinking");
    expect(customerStatus({ ...plan, status: "ACTIVE", mandateStatus: "active" }, unpaid)).toBe("dd_started");
    expect(customerStatus({ ...plan, status: "ACTIVE", mandateStatus: "active" }, { ...unpaid, paid: true })).toBe("active");
    expect(customerStatus({ ...plan, status: "ACTIVE", paymentFailedAt: new Date() }, { ...unpaid, paid: true })).toBe("payment_failing");
    expect(customerStatus({ ...plan, status: "CANCELLED" }, unpaid)).toBe("cancelled");
  });
});
