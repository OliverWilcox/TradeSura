import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as funnel } from "@/app/api/admin/v1/dashboard/engineer-funnel/route";
import { engineerFunnelOf, ENGINEER_FUNNEL_STEPS } from "@/lib/admin/engineer-funnel";
import { call, resetDb, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(resetDb);

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
const JULY_TO_NOV = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };

async function letters() {
  const codes = ["A", "B", "C", "D", "E", "F"];
  for (const c of codes) {
    await prisma.claimCode.create({ data: { code: `TS-${c}`, firstName: c, businessName: `${c} Gas`, letterBatch: "2026-10-A", variantCell: "A", createdAt: day(2), suppressedAt: c === "F" ? day(3) : null } });
  }
  await prisma.claimCode.create({ data: { code: "TS-OLD", firstName: "Old", businessName: "Old Gas", letterBatch: "2026-09-A", variantCell: "A", createdAt: new Date(Date.UTC(2026, 8, 1)) } });
  const step = (code: string, s: string, d: number) => prisma.event.create({ data: { name: "claim_step", actorType: "SYSTEM", ts: day(d), meta: { code: `TS-${code}`, step: s } } });
  for (const c of ["A", "B", "C", "D"]) await step(c, "scan", 4);
  for (const c of ["A", "B", "C"]) await step(c, "form_completed", 5);
  await step("A", "store_opened", 6);
  await step("B", "app_link_opened", 6);
  for (const c of ["A", "B", "C"]) await prisma.claimCode.update({ where: { code: `TS-${c}` }, data: { claimedAt: day(5) } });

  const a = await makeEngineer({ gasSafeCardUrl: "https://x/card.jpg", gasSafeVerifiedAt: day(9), stripeAccountId: "acct_a", stripeDetailsSubmitted: true, stripeChargesEnabled: true, stripePayoutsEnabled: true, accountCompletedAt: day(12), gasSafeRegisterCheckedAt: day(20) });
  const b = await makeEngineer({ gasSafeCardUrl: "https://x/card.jpg", gasSafeVerifiedAt: day(10) });
  await prisma.claimCode.update({ where: { code: "TS-A" }, data: { redeemedByEngineerId: a.id, redeemedAt: day(7) } });
  await prisma.claimCode.update({ where: { code: "TS-B" }, data: { redeemedByEngineerId: b.id, redeemedAt: day(8) } });
  await prisma.event.create({ data: { name: "gas_safe_card_added", actorType: "ENGINEER", actorId: a.id, ts: day(8) } });
  await prisma.planTier.create({ data: { engineerId: a.id, name: "Care", priceMonthlyPence: 1500, sortOrder: 1, status: "LIVE" } });
  const c = await makeCustomer(a.id);
  const p = await makePlan(a.id, c.id, { activatedAt: day(15), linkOpenedAt: day(14) });
  await prisma.event.create({ data: { name: "offer_sent", actorType: "ENGINEER", actorId: a.id, ts: day(14), meta: { planId: p.id, customerId: c.id, channel: "sms" } } });
  await prisma.stripeWebhookEvent.create({ data: { id: "evt_po_1", type: "payout.paid", processedAt: day(18), payload: { account: "acct_a", data: { object: { id: "po_1", amount: 1200 } } } } });
  return { a, b };
}

describe("the engineer funnel", () => {
  it("counts the letters in the range and each step as a subset of the one before, with the store step marked no data", async () => {
    await letters();
    const res = await call(funnel, { query: JULY_TO_NOV });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ batches: 1, letters: 5 });
    const counts = Object.fromEntries(res.body.steps.map((s: { key: string; count: number | null }) => [s.key, s.count]));
    expect(counts).toEqual({
      letters_posted: 5,
      claim_scans: 4,
      details_completed: 3,
      store_opened: 2,
      store_downloads: null,
      signed_up: 2,
      card_uploaded: 2,
      card_check_passed: 2,
      plans_live_stage1: 1,
      first_offer: 1,
      first_customer: 1,
      stage2_done: 1,
      first_payout: 1,
      register_check_passed: 1,
    });
    const store = res.body.steps.find((s: { key: string }) => s.key === "store_downloads");
    expect(store).toMatchObject({ count: null, noData: "App Store Connect and Play Console", ofStart: null, fromPrevious: null });
    const signed = res.body.steps.find((s: { key: string }) => s.key === "signed_up");
    expect(signed).toMatchObject({ comparedWith: "letters_posted", fromPrevious: 0.4, ofStart: 0.4, note: expect.stringMatching(/typed into the app/) });
    expect(res.body.steps.find((s: { key: string }) => s.key === "claim_scans")).toMatchObject({ comparedWith: "letters_posted", medianDaysFromPrevious: 2, medianOf: 4 });
    expect(signed).toMatchObject({ medianDaysFromPrevious: 5.5, medianOf: 2 });
    expect(res.body.steps.find((s: { key: string }) => s.key === "card_uploaded")).toMatchObject({ comparedWith: "signed_up" });
    expect(res.body.steps.map((s: { label: string }) => s.label)).toEqual(ENGINEER_FUNNEL_STEPS.map((s) => s.label));
  });

  it("counts the register check from the card check, as it doesn't wait for a first payout", async () => {
    const { b } = await letters();
    await prisma.engineer.update({ where: { id: b.id }, data: { gasSafeRegisterCheckedAt: day(13) } });
    const res = await call(funnel, { query: JULY_TO_NOV });
    const step = res.body.steps.find((s: { key: string }) => s.key === "register_check_passed");
    expect(step).toMatchObject({ count: 2, comparedWith: "card_check_passed", fromPrevious: 1, medianDaysFromPrevious: 7, medianOf: 2, note: expect.stringMatching(/doesn't wait for plans, customers or payouts/) });
    expect(res.body.steps.find((s: { key: string }) => s.key === "first_payout").count).toBe(1);
  });

  it("refuses a visit reason that doesn't exist rather than showing zeros", async () => {
    const res = await call(funnel, { query: { ...JULY_TO_NOV, reason: "made_up" } });
    expect(res.status).toBe(400);
  });

  it("counts a sign-up with a code typed into the app, with no claim-page steps", async () => {
    await letters();
    const typed = await makeEngineer({});
    await prisma.claimCode.update({ where: { code: "TS-E" }, data: { redeemedByEngineerId: typed.id, redeemedAt: day(9) } });
    const counts = Object.fromEntries((await call(funnel, { query: JULY_TO_NOV })).body.steps.map((s: { key: string; count: number | null }) => [s.key, s.count]));
    expect(counts).toMatchObject({ store_opened: 2, signed_up: 3, card_uploaded: 2 });
  });

  it("is empty for a range with no letters, and needs dashboard:read", async () => {
    await letters();
    const res = await call(funnel, { query: { from: "2026-12-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" } });
    expect(res.body).toMatchObject({ batches: 0, letters: 0 });
    expect(res.body.steps[0]).toMatchObject({ count: 0, ofStart: 0 });
    expect((await call(funnel, { query: JULY_TO_NOV, as: withPermissions("engineers:read") })).status).toBe(403);
  });

  it("the maths: a step done early counts with the step before, and no step outgrows the one before", () => {
    const at = (d: number) => new Date(Date.UTC(2026, 9, d));
    const reach = (over: Partial<Record<string, Date | null | false>>) =>
      Object.fromEntries(ENGINEER_FUNNEL_STEPS.map((s) => [s.key, over[s.key] === false || !(s.key in over) ? { reached: false, at: null } : { reached: true, at: over[s.key] ?? null }])) as Parameters<typeof engineerFunnelOf>[0][number];
    const items = [
      reach({ letters_posted: at(1), claim_scans: at(2), details_completed: at(3), store_opened: at(4), signed_up: at(6), card_uploaded: at(5), card_check_passed: at(8) }),
      reach({ letters_posted: at(1), claim_scans: at(2), details_completed: at(3), store_opened: at(4), signed_up: at(6) }),
      reach({ letters_posted: at(1), claim_scans: false, details_completed: at(3) }),
    ];
    const steps = engineerFunnelOf(items);
    const counts = steps.filter((s) => s.count !== null).map((s) => s.count!);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
    expect(counts.slice(0, 7)).toEqual([3, 2, 2, 2, 2, 1, 1]);
    expect(steps.find((s) => s.key === "card_uploaded")).toMatchObject({ medianDaysFromPrevious: 0, medianOf: 1 });
  });
});
