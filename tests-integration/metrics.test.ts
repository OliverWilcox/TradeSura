import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as statsRoute } from "@/app/api/admin/v1/dashboard/stats/route";
import { GET as signupsRoute } from "@/app/api/admin/v1/dashboard/signups/route";
import { GET as funnelRoute } from "@/app/api/admin/v1/dashboard/funnel/route";
import { GET as moneyRoute } from "@/app/api/admin/v1/dashboard/money/route";
import { GET as customersRoute } from "@/app/api/admin/v1/customers/route";
import { GET as customerRoute } from "@/app/api/admin/v1/customers/[customerId]/route";
import { GET as customerActivityRoute } from "@/app/api/admin/v1/customers/[customerId]/activity/route";
import { POST as winBackRoute } from "@/app/api/admin/v1/customers/[customerId]/win-back/route";
import { GET as engineersRoute } from "@/app/api/admin/v1/engineers/route";
import { GET as engineerRoute } from "@/app/api/admin/v1/engineers/[engineerId]/route";
import { computeApplicationFeePence } from "@/lib/stripe";
import { customerStatus, deliveryOf, funnelOf, payments, testMarks, type Milestones } from "@/lib/admin/metrics";
import { call, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";
import { clientFixture, OCTOBER } from "./client-fixture";

// The client's dashboard of 31 October 2026, rebuilt (client-fixture.ts):
// every card, funnel step and list must tell the same story.

// Texts are recorded, never sent.
// `twilio` says what the provider does with them (QA-05).
const texts = vi.hoisted(() => [] as { to: string; body: string; messageClass: string }[]);
const twilio = vi.hoisted(() => ({ configured: true, takes: true }));
vi.mock("@/lib/sms", () => ({
  sendSms: async (o: { to: string; body: string; messageClass: string }) => {
    texts.push(o);
    return { sent: true, delivered: twilio.configured && twilio.takes, id: "sms_1" };
  },
  smsConfigured: () => twilio.configured,
}));

beforeEach(async () => {
  texts.length = 0;
  Object.assign(twilio, { configured: true, takes: true });
  await resetDb();
});

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
      ["Gone live", 3],
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
    // Texts sent before receipts were kept: delivered, as agreed.
    expect(deliveryOf({ channel: "sms", openedAt: null })).toBe("delivered");
  });

  it("call a text delivered or failed by its receipt, and not confirmed while it's waiting (QA-02)", () => {
    const at = new Date();
    expect(deliveryOf({ channel: "sms", openedAt: null, text: { deliveredAt: at, failedAt: null } })).toBe("delivered");
    expect(deliveryOf({ channel: "sms", openedAt: null, text: { deliveredAt: null, failedAt: at } })).toBe("failed");
    expect(deliveryOf({ channel: "sms", openedAt: null, text: { deliveredAt: null, failedAt: null } })).toBe("unconfirmed");
    // Opened beats anything the receipt said.
    expect(deliveryOf({ channel: "sms", openedAt: at, text: { deliveredAt: null, failedAt: at } })).toBe("delivered");
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

describe("the client's lists", () => {
  it("agree with the dashboard on customers, payments and who's active", async () => {
    // The fixture is the client's data on 31 October 2026: "the last 7 days" is counted from then.
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00Z"), toFake: ["Date"] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const f = await clientFixture();
    const customers = (await call(customersRoute, { query: { engineerId: f.md.id, size: "50" } })).body.items;
    const byName = Object.fromEntries(customers.map((c: { name: string }) => [c.name, c]));
    // 2.1: Oliver paid, and is the one first payment and the £12.
    expect(byName["Oliver Wilcox"]).toMatchObject({ status: "active", firstPaymentAt: "2026-10-29T09:00:00.000Z", plan: { payment: "paid", priceMonthlyPence: 1200 } });
    // Sam's Direct Debit is set up; nothing collected yet (only the £0 trial invoice).
    expect(byName["Sam Taylor"]).toMatchObject({ status: "dd_started", plan: { payment: "none" } });
    // 5.3: Jess's WhatsApp offer never went; she isn't "awaiting mandate". 5.4: the price is the plan she was offered.
    expect(byName["Jess Brown"]).toMatchObject({ status: "offer_unconfirmed", plan: { status: "PENDING", priceMonthlyPence: 2299 } });

    // Customers on plan (2) and plans live (2) are Oliver and Sam.
    expect(customers.filter((c: { status: string }) => ["active", "dd_started"].includes(c.status))).toHaveLength(2);

    // 2.2: only 302 MD LTD sent a delivered offer in the last 7 days.
    const engineers = (await call(engineersRoute, { query: { size: "50" } })).body.items;
    const active = engineers.filter((e: { status: string }) => e.status === "active").map((e: { id: string }) => e.id);
    expect(active).toEqual([f.md.id]);
    // Test data is listed, labelled.
    expect(engineers.filter((e: { isTest: boolean }) => e.isTest).map((e: { id: string }) => e.id).sort()).toEqual(f.testers.map((t) => t.id).sort());

    // 4.3: on plan and in book, on the record.
    const md = (await call(engineerRoute, { params: { engineerId: f.md.id } })).body;
    expect(md.counts).toMatchObject({ customers: 3, customersOnPlans: 2 });
    expect(md.steps.map((s: { reached: boolean }) => s.reached)).toEqual([true, true, true, true, true]);
    // The record's customers carry the same statuses as the customer list.
    const recent = Object.fromEntries(md.recentCustomers.map((c: { name: string; status: string }) => [c.name, c.status]));
    expect(recent).toEqual({ "Oliver Wilcox": "active", "Sam Taylor": "dd_started", "Jess Brown": "offer_unconfirmed" });
  });

  it("filter customers by the status they show", async () => {
    const f = await clientFixture();
    const ids = async (status: string) => (await call(customersRoute, { query: { status } })).body.items.map((c: { id: string }) => c.id);
    expect(await ids("offer_unconfirmed")).toEqual([f.jess.id]);
    expect(await ids("dd_started")).toEqual([f.sam.id]);
  });
});

describe("a customer's record", () => {
  it("hides the £0 trial invoices and never counts them as a first payment", async () => {
    const f = await clientFixture();
    const sam = (await call(customerRoute, { params: { customerId: f.sam.id } })).body;
    expect(sam.payments).toEqual([]);
    expect(sam.zeroInvoicesHidden).toBe(1);
    expect(sam.firstPaymentAt).toBeNull();
    const oliver = (await call(customerRoute, { params: { customerId: f.oliver.id } })).body;
    expect(oliver.payments.map((p: { amountPence: number }) => p.amountPence)).toEqual([1200]);
    // Added at the door, but joined from the engineer's offer link (Matt, 4 Nov: Matthew Wood).
    expect(oliver).toMatchObject({ status: "active", source: "offer_link", firstPaymentAt: "2026-10-29T09:00:00.000Z" });
  });

  // 5.5: built from the events, not "Nothing yet".
  it("has a timeline from the offer onwards, with the retention screen and the reason", async () => {
    const f = await clientFixture();
    await prisma.event.createMany({
      data: [
        { name: "signup_opened", actorType: "CUSTOMER", actorId: f.oliver.id, ts: new Date("2026-10-20T10:05:00Z"), meta: { planId: f.oliverPlan.id } },
        { name: "mandate_active", actorType: "CUSTOMER", actorId: f.oliver.id, ts: new Date("2026-10-20T12:00:00Z"), meta: { planId: f.oliverPlan.id } },
        { name: "payment_confirmed", actorType: "SYSTEM", ts: new Date("2026-10-29T09:00:00Z"), meta: { planId: f.oliverPlan.id, amountPence: 1200 } },
        { name: "plan_cancelled", actorType: "SYSTEM", ts: new Date("2026-10-30T09:00:00Z"), meta: { planId: f.oliverPlan.id, reason: "end_of_paid_period" } },
      ],
    });
    await prisma.cancelRequest.create({ data: { planId: f.oliverPlan.id, engineerId: f.md.id, reason: "too_expensive", offer: "cheaper_plan", outcome: "cancelled", createdAt: new Date("2026-10-29T12:00:00Z") } });
    const items = (await call(customerActivityRoute, { params: { customerId: f.oliver.id } })).body.items;
    // The payment is the invoice (the £0 trial left out); "plan started" comes from the plan.
    // The engineer is alerted the moment a customer starts to cancel (Matt, 4 Nov).
    expect(items.map((i: { name: string }) => i.name)).toEqual(["plan_cancelled", "engineer_alerted", "cancel_requested", "payment_confirmed", "mandate_active", "plan_live", "signup_opened", "offer_sent"]);
    expect(items[2].detail).toMatchObject({ reason: "too_expensive", offer: "cheaper_plan", outcome: "cancelled" });
    expect(items[3]).toMatchObject({ id: "invoice:in_oliver_1", detail: { amountPence: 1200 } });
    expect(items[7].detail.channel).toBe("sms");
  });

  // QA-04: the app records only the first payment as an event; the timeline lists what the payment history lists.
  it("lists every payment the payment history does, and the plan's own dates where nothing was recorded", async () => {
    const f = await clientFixture();
    await prisma.event.create({ data: { name: "payment_confirmed", actorType: "SYSTEM", ts: new Date("2026-10-29T09:00:00Z"), meta: { planId: f.oliverPlan.id, amountPence: 1200 } } });
    await prisma.stripeWebhookEvent.createMany({
      data: [
        { id: "evt_oliver_fail", type: "invoice.payment_failed", processedAt: new Date("2026-11-28T09:00:00Z"), payload: { data: { object: { id: "in_oliver_2", amount_due: 1200, subscription: "sub_oliver" } } } },
        { id: "evt_oliver_2", type: "invoice.paid", processedAt: new Date("2026-12-01T09:00:00Z"), payload: { data: { object: { id: "in_oliver_2", amount_paid: 1200, subscription: "sub_oliver", status_transitions: { paid_at: Date.parse("2026-12-01T09:00:00Z") / 1000 } } } } },
      ],
    });
    await prisma.plan.update({ where: { id: f.oliverPlan.id }, data: { paymentFailedAt: new Date("2026-11-28T09:00:00Z"), paymentRecoveredAt: new Date("2026-12-01T09:00:00Z"), status: "CANCELLED", cancelledAt: new Date("2026-12-20T09:00:00Z") } });

    const [record, activity] = await Promise.all([
      call(customerRoute, { params: { customerId: f.oliver.id } }),
      call(customerActivityRoute, { params: { customerId: f.oliver.id } }),
    ]);
    const items: { name: string; at: string; detail: { amountPence: number | null } }[] = activity.body.items;
    const shown = (name: string) => items.filter((i) => i.name === name).map((i) => [i.at, i.detail.amountPence]);
    const history = (status: string) => record.body.payments.filter((p: { status: string }) => p.status === status).map((p: { at: string; amountPence: number }) => [p.at, p.amountPence]);
    expect(shown("payment_confirmed")).toEqual(history("paid"));
    expect(shown("payment_confirmed")).toHaveLength(2);
    expect(shown("payment_failed")).toEqual(history("failed"));
    expect(items.map((i) => i.name)).toEqual(expect.arrayContaining(["signup_opened", "plan_live", "payment_recovered", "plan_cancelled"]));
    // Each once: from the plan only where no event says so.
    expect(items.filter((i) => i.name === "plan_live")).toHaveLength(1);
  });
});

describe("win back (5.7)", () => {
  it("texts a cancelled customer their rejoin link, and records it", async () => {
    const f = await clientFixture();
    await prisma.plan.update({ where: { id: f.oliverPlan.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    const res = await call(winBackRoute, { params: { customerId: f.oliver.id } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "sent", notSent: null });
    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatchObject({ to: f.oliver.phone, messageClass: "MARKETING" });
    const token = (await prisma.plan.findUniqueOrThrow({ where: { id: f.oliverPlan.id } })).rejoinToken;
    expect(texts[0].body).toContain(`/rejoin/${token}`);
    expect(await prisma.event.findFirst({ where: { name: "customer_win_back_sent" } })).toMatchObject({ actorType: "ADMIN" });
  });

  it("says a win-back text didn't go, and why, instead of calling it sent (QA-05)", async () => {
    const f = await clientFixture();
    await prisma.plan.update({ where: { id: f.oliverPlan.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    twilio.configured = false;
    expect((await call(winBackRoute, { params: { customerId: f.oliver.id } })).body).toEqual({ status: "not_sent", notSent: "not_configured" });
    Object.assign(twilio, { configured: true, takes: false });
    expect((await call(winBackRoute, { params: { customerId: f.oliver.id } })).body).toEqual({ status: "not_sent", notSent: "refused" });
    expect(await prisma.event.count({ where: { name: "customer_win_back_failed" } })).toBe(2);
    expect(await prisma.event.count({ where: { name: "customer_win_back_sent" } })).toBe(0);
  });

  it("refuses anyone who opted out, or whose plan hasn't ended", async () => {
    const f = await clientFixture();
    expect((await call(winBackRoute, { params: { customerId: f.oliver.id } })).status).toBe(409); // still on their plan
    await prisma.plan.update({ where: { id: f.oliverPlan.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    await prisma.suppression.create({ data: { channel: "sms", value: f.oliver.phone, source: "sms_stop" } });
    const res = await call(winBackRoute, { params: { customerId: f.oliver.id } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("They've opted out of texts.");
    expect((await call(customerRoute, { params: { customerId: f.oliver.id } })).body.winBack).toEqual({ available: false, reason: "They've opted out of texts." });
    expect(texts).toHaveLength(0);
  });
});
