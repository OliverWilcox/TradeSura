import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as statsRoute } from "@/app/api/admin/v1/dashboard/stats/route";
import { GET as signupsRoute } from "@/app/api/admin/v1/dashboard/signups/route";
import { GET as funnelRoute } from "@/app/api/admin/v1/dashboard/funnel/route";
import { GET as moneyRoute } from "@/app/api/admin/v1/dashboard/money/route";
import { GET as healthRoute } from "@/app/api/admin/v1/dashboard/health/route";
import { GET as coreRoute } from "@/app/api/admin/v1/dashboard/core/route";
import { GET as waitingRoute } from "@/app/api/admin/v1/dashboard/waiting/route";
import { call, CHECKER, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

// The dashboard's sections from real rows, over July 2026 in UK time:
// 00:00 1 July to 00:00 1 August (both BST, so 23:00 UTC the day before).

beforeEach(resetDb);

const JULY = { from: "2026-06-30T23:00:00.000Z", to: "2026-07-31T23:00:00.000Z" };

describe("dashboard sign-ups", () => {
  it("count engineer sign-ups by UK day, and by channel", async () => {
    await makeEngineer({ createdAt: new Date("2026-07-01T23:30:00Z"), attribution: { heardVia: "letter" } }); // 2 July in the UK
    await makeEngineer({ createdAt: new Date("2026-07-02T10:00:00Z"), attribution: { heardVia: "letter" } });
    await makeEngineer({ createdAt: new Date("2026-07-05T10:00:00Z"), attribution: { heardVia: "online" } });
    await makeEngineer({ createdAt: new Date("2026-06-30T22:30:00Z") }); // 23:30 on 30 June in the UK: outside
    const owner = await makeEngineer({ createdAt: new Date("2026-07-03T10:00:00Z") });
    await makeEngineer({ createdAt: new Date("2026-07-03T11:00:00Z"), ownerId: owner.id }); // staff aren't sign-ups

    const res = await call(signupsRoute, { query: JULY });
    expect(res.status).toBe(200);
    expect(res.body.byDay).toHaveLength(31);
    expect(res.body.byDay.slice(0, 5)).toEqual([
      { date: "2026-07-01", count: 0 },
      { date: "2026-07-02", count: 2 },
      { date: "2026-07-03", count: 1 },
      { date: "2026-07-04", count: 0 },
      { date: "2026-07-05", count: 1 },
    ]);
    expect(res.body.channels[0]).toEqual({ channel: "letter", count: 2, share: 0.5 });
    expect((await call(statsRoute, { query: JULY })).body.signups).toBe(4);
  });
});

describe("dashboard headline numbers", () => {
  it("count offers, sign-ups from them, live plans, customers and active engineers", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date("2026-06-01") });
    const [c1, c2, c3] = [await makeCustomer(e.id), await makeCustomer(e.id), await makeCustomer(e.id)];
    await makePlan(e.id, c1.id, { createdAt: new Date("2026-07-10"), activatedAt: new Date("2026-07-12"), mandateStatus: "active" });
    await makePlan(e.id, c2.id, { createdAt: new Date("2026-07-20"), status: "PENDING", activatedAt: null });
    await makePlan(e.id, c3.id, { createdAt: new Date("2026-05-01"), activatedAt: new Date("2026-05-02"), cancelledAt: new Date("2026-07-15"), status: "CANCELLED" });
    await makeEngineer({ gasSafeVerifiedAt: new Date("2026-06-01") }); // verified, sent nothing

    const s = (await call(statsRoute, { query: JULY })).body;
    expect(s).toMatchObject({
      offers: 2,
      conversion: { sent: 2, converted: 1, rate: 0.5 },
      plansLive: 1, // c3's ended mid-July
      customers: 1,
      active: 1,
      verified: { inPeriod: 0, allTime: 2 },
    });
  });

  it("count a customer only once their mandate is set up, as the Prisma query did", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date("2026-06-01") });
    const [c1, c2, c3] = [await makeCustomer(e.id), await makeCustomer(e.id), await makeCustomer(e.id)];
    await makePlan(e.id, c1.id, { activatedAt: new Date("2026-07-02"), mandateStatus: "active" });
    await makePlan(e.id, c1.id, { activatedAt: new Date("2026-07-03"), mandateStatus: "active" });
    await makePlan(e.id, c2.id, { activatedAt: new Date("2026-07-02"), mandateStatus: "pending" });
    await makePlan(e.id, c3.id, { activatedAt: new Date("2026-07-02"), mandateStatus: null });

    expect((await call(statsRoute, { query: JULY })).body).toMatchObject({ plansLive: 4, customers: 1 });
  });

  it("refuse a backwards or missing range", async () => {
    expect((await call(statsRoute, { query: { from: JULY.to, to: JULY.from } })).status).toBe(400);
    expect((await call(statsRoute)).status).toBe(400);
  });

  it("are closed to verification checkers", async () => {
    expect((await call(statsRoute, { as: CHECKER, query: JULY })).status).toBe(403);
  });
});

describe("the activation funnel", () => {
  it("follows each new engineer through the steps", async () => {
    const a = await makeEngineer({ createdAt: new Date("2026-07-01T09:00:00Z"), stripeChargesEnabled: true });
    await makeEngineer({ createdAt: new Date("2026-07-02T09:00:00Z") });
    await prisma.event.createMany({
      data: [
        { name: "stripe_onboarded", actorType: "ENGINEER", actorId: a.id, ts: new Date("2026-07-03T09:00:00Z") },
        { name: "plan_live", actorType: "ENGINEER", actorId: a.id, ts: new Date("2026-07-04T09:00:00Z"), meta: { tierId: "t1" } },
      ],
    });
    const c = await makeCustomer(a.id);
    await makePlan(a.id, c.id, { createdAt: new Date("2026-07-05"), activatedAt: new Date("2026-07-08T09:00:00Z") });

    const steps = (await call(funnelRoute, { query: JULY })).body;
    expect(steps.map((s: { label: string; count: number }) => [s.label, s.count])).toEqual([
      ["Signed up", 2],
      ["Payments set up", 1],
      ["First plan live", 1],
      ["First customer", 1],
      ["First payment", 0],
    ]);
    expect(steps[1]).toMatchObject({ ofStart: 0.5, fromPrevious: 0.5, medianDaysFromPrevious: 2 });
    expect(steps[3].medianDaysFromPrevious).toBe(4);
  });
});

describe("dashboard money", () => {
  it("adds up paid invoices from the Stripe events, by UK month", async () => {
    const paid = (id: string, at: string, amount: number, fee: number | null) => ({
      id,
      type: "invoice.paid",
      payload: { data: { object: { amount_paid: amount, application_fee_amount: fee, status_transitions: { paid_at: Math.floor(new Date(at).getTime() / 1000) } } } },
    });
    await prisma.stripeWebhookEvent.createMany({
      data: [
        paid("evt_1", "2026-07-05T10:00:00Z", 2000, 400),
        paid("evt_2", "2026-07-31T23:30:00Z", 1500, null), // 00:30 on 1 August in the UK; no fee recorded → 20%
        paid("evt_3", "2026-06-15T10:00:00Z", 1800, 360),
        { id: "evt_4", type: "invoice.payment_failed", payload: {} },
      ],
    });
    const res = await call(moneyRoute, { query: JULY });
    expect(res.status).toBe(200);
    expect(res.body.period).toEqual({ count: 1, grossPence: 2000, refundedPence: 0, claimedPence: 0, netPence: 2000, feePence: 400 });
    const months = Object.fromEntries(res.body.months.map((m: { month: string; grossPence: number; feePence: number }) => [m.month, [m.grossPence, m.feePence]]));
    expect(months["2026-08"]).toEqual([1500, 300]);
    expect(res.body.months).toHaveLength(6);
  });
});

describe("dashboard health", () => {
  it("counts cancellations with their reasons, and failed payments", async () => {
    const e = await makeEngineer();
    const live = await makeCustomer(e.id);
    await makePlan(e.id, live.id, { activatedAt: new Date("2026-05-01"), mandateStatus: "active" });
    const gone = await makeCustomer(e.id);
    const plan = await makePlan(e.id, gone.id, { activatedAt: new Date("2026-05-01"), cancelledAt: new Date("2026-07-10"), status: "CANCELLED", mandateStatus: "inactive" });
    await prisma.cancelRequest.create({ data: { planId: plan.id, engineerId: e.id, reason: "moving", outcome: "cancelled" } });
    const failing = await makeCustomer(e.id);
    await makePlan(e.id, failing.id, { priceMonthlyPence: 2500, paymentFailedAt: new Date("2026-07-20"), paymentRecoveredAt: new Date("2026-07-23") });

    const h = (await call(healthRoute, { query: JULY })).body;
    // On a plan on 1 July: `live` and `gone` (the failing one started in October).
    expect(h.cancellations).toEqual({ count: 1, rate: 0.5, activeAtStart: 2, topReasons: [{ reason: "Moving house", count: 1 }] });
    expect(h.failed).toMatchObject({ count: 1, failedPence: 2500, recovered: 1, outstanding: 0, recoveryRate: 1 });
  });
});

describe("the core number", () => {
  it("has the last complete week, this week so far and a 12-week trend", async () => {
    const res = await call(coreRoute);
    expect(res.status).toBe(200);
    expect(res.body.trend).toHaveLength(12);
    expect(res.body.lastWeek).toEqual(res.body.trend[11]);
    expect(Object.keys(res.body.weekToDate)).toEqual(["weekStart", "offers", "activeEngineers", "value"]);
  });
});

describe("what's waiting", () => {
  it("counts the verification queue, packs to post and open cancel requests", async () => {
    await makeEngineer(); // waiting for verification
    await makeEngineer({ gasSafeVerifiedAt: new Date(), packRequestedAt: new Date(), packAddress: "1 High St" });
    expect((await call(waitingRoute)).body).toEqual({ verifications: 1, memberPacks: 1, cancelRequests: 0 });
  });
});
