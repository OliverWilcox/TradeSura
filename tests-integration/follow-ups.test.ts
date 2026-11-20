import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as lists } from "@/app/api/admin/v1/follow-ups/route";
import { POST as logCall } from "@/app/api/admin/v1/engineers/[engineerId]/calls/route";
import { GET as engineer } from "@/app/api/admin/v1/engineers/[engineerId]/route";
import { GET as batches } from "@/app/api/admin/v1/letters/batches/route";
import { GET as mailHouse } from "@/app/api/admin/v1/letters/batches/[batch]/mail-house/route";
import { call, resetDb, SUPER_ADMIN, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("APP_URL", "https://tradesura.com");
});
afterEach(() => vi.unstubAllEnvs());

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysOn = (n: number) => new Date(Date.now() + n * DAY);

async function quietFor(days: number | null, data: Record<string, unknown> = {}) {
  const e = await makeEngineer({ gasSafeVerifiedAt: daysAgo(60), ...data });
  const offeredAt = days === null ? null : daysAgo(days);
  if (offeredAt) {
    const c = await makeCustomer(e.id);
    const p = await makePlan(e.id, c.id, { status: "PENDING", activatedAt: null, linkOpenedAt: offeredAt });
    await prisma.event.create({ data: { name: "offer_sent", actorType: "ENGINEER", actorId: e.id, ts: offeredAt, meta: { planId: p.id, customerId: c.id, channel: "sms" } } });
  }
  return Object.assign(e, { spell: offeredAt?.toISOString() ?? e.gasSafeVerifiedAt!.toISOString() });
}

describe("the call list", () => {
  it("lists day-10 engineers, longest quiet first, with the ladder's sends and the last call", async () => {
    const twelve = await quietFor(12, { tradingName: "Ash Gas" });
    const sixty = await quietFor(null, { tradingName: "Birch Heating" });
    await quietFor(9, { tradingName: "Cedar Boilers" });
    await quietFor(15, { tradingName: "Dale Gas", pausedAt: daysAgo(1) });
    await makeEngineer({ tradingName: "Elm staff", ownerId: twelve.id, gasSafeVerifiedAt: daysAgo(60) });
    for (const [step, channel] of [[1, "push"], [2, "whatsapp"], [3, "email"]] as const) {
      await prisma.event.create({ data: { name: "follow_up_sent", actorType: "SYSTEM", ts: daysAgo(12 - step * 2), meta: { engineerId: twelve.id, step, channel, from: twelve.spell, went: step !== 2 } } });
    }
    await prisma.event.create({ data: { name: "engineer_called", actorType: "ADMIN", actorId: "adm", ts: daysAgo(1), meta: { engineerId: sixty.id, adminName: "Matt", note: "Left a voicemail" } } });

    const res = await call(lists, { query: { tab: "calls" } });
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({ calls: 2, stripe: 0 });
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((r: { business: string; days: number; countingFrom: string }) => [r.business, r.days, r.countingFrom])).toEqual([
      ["Birch Heating", 60, "live"],
      ["Ash Gas", 12, "last_offer"],
    ]);
    expect(res.body.items[1].sent.map((s: { step: number; went: boolean }) => [s.step, s.went])).toEqual([
      [3, true],
      [2, false],
      [1, true],
    ]);
    expect(res.body.items[1].phone).toMatch(/^••••/);
    expect(res.body.items[0].lastCall).toMatchObject({ by: "Matt", note: "Left a voicemail" });
    expect(res.body.items[1].lastCall).toBeNull();
    expect((await call(lists, { query: { tab: "calls", q: "birch" } })).body.items.map((r: { business: string }) => r.business)).toEqual(["Birch Heating"]);
    expect((await call(lists, { query: { tab: "stripe" } })).body.items).toEqual([]);
    expect((await call(lists, { as: withPermissions("customers:read") })).status).toBe(403);
  });

  it("the record shows the same sends and the last call", async () => {
    const e = await quietFor(12);
    await prisma.event.create({ data: { name: "follow_up_sent", actorType: "SYSTEM", meta: { engineerId: e.id, step: 1, channel: "push", from: e.spell, went: true } } });
    await prisma.event.create({ data: { name: "follow_up_sent", actorType: "SYSTEM", meta: { engineerId: e.id, step: 1, channel: "push", from: daysAgo(40).toISOString(), went: true } } });
    const res = await call(engineer, { params: { engineerId: e.id } });
    expect(res.body.chase).toMatchObject({ days: 12, step: { step: 4, channel: "call" }, sent: [{ step: 1, channel: "push", went: true }] });
    expect(res.body.chase.sent).toHaveLength(1);
    expect(res.body.lastCall).toBeNull();
  });
});

describe("Stripe stage 2 due", () => {
  it("lists finished accounts Stripe still wants something from, soonest deadline first, urgent within 7 days", async () => {
    const soon = await makeEngineer({ tradingName: "Ash Gas", stripeAccountId: "acct_1", stripeDetailsSubmitted: true, stripeChargesEnabled: true, stripePayoutsEnabled: false, stripeRequirementsDeadline: daysOn(3.5) });
    await makeEngineer({ tradingName: "Birch Heating", stripeAccountId: "acct_2", stripeDetailsSubmitted: true, stripePayoutsEnabled: false, stripeRequirementsDeadline: daysOn(20.5) });
    await makeEngineer({ tradingName: "Cedar Boilers", stripeAccountId: "acct_3", stripeDetailsSubmitted: true, stripePayoutsEnabled: false });
    await makeEngineer({ tradingName: "Dale Gas", stripeAccountId: "acct_4", stripeDetailsSubmitted: false, stripeOnboardingStartedAt: daysAgo(1) });
    await makeEngineer({ tradingName: "Elm Heating", stripeAccountId: "acct_5", stripeDetailsSubmitted: true, stripeChargesEnabled: true, stripePayoutsEnabled: true });
    await makePlan(soon.id, (await makeCustomer(soon.id)).id);
    const res = await call(lists, { query: { tab: "stripe" } });
    expect(res.body.counts.stripe).toBe(3);
    expect(res.body.items.map((r: { business: string; urgent: boolean; daysLeft: number | null; customersOnPlan: number }) => [r.business, r.urgent, r.daysLeft, r.customersOnPlan])).toEqual([
      ["Ash Gas", true, 3, 1],
      ["Birch Heating", false, 20, 0],
      ["Cedar Boilers", false, null, 0],
    ]);
    expect(res.body.items[0].stripe).toEqual({ stage1: "done", stage2: "due" });
  });
});

describe("logging a call", () => {
  it("records who called and what came of it, and refuses staff and a missing note", async () => {
    const e = await makeEngineer({ tradingName: "Ash Gas" });
    const staff = await makeEngineer({ ownerId: e.id });
    const res = await call(logCall, { params: { engineerId: e.id }, body: { note: "Spoke to Dave: sending offers again from Monday" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ by: SUPER_ADMIN.name });
    const ev = await prisma.event.findFirstOrThrow({ where: { name: "engineer_called" } });
    expect(ev.actorType).toBe("ADMIN");
    expect(ev.meta).toMatchObject({ engineerId: e.id, note: "Spoke to Dave: sending offers again from Monday", adminName: SUPER_ADMIN.name });
    expect((await call(logCall, { params: { engineerId: staff.id }, body: { note: "Rang the apprentice" } })).status).toBe(409);
    expect((await call(logCall, { params: { engineerId: e.id }, body: { note: "" } })).status).toBe(400);
    expect((await call(logCall, { params: { engineerId: e.id }, body: { note: "No permission" }, as: withPermissions("engineers:read") })).status).toBe(403);
  });
});

describe("the second letter", () => {
  async function batch(name: string, uploadedDaysAgo: number) {
    const rows = [
      { code: `${name}-A`, firstName: "Ann", businessName: "Ann Gas", claimedAt: daysAgo(2) },
      { code: `${name}-B`, firstName: "Bob", businessName: "Bob Heating", suppressedAt: daysAgo(1) },
      { code: `${name}-C`, firstName: "Cat", businessName: "Cat Boilers" },
      { code: `${name}-D`, firstName: "Dan", businessName: "Dan Plumbing" },
    ];
    for (const r of rows) {
      await prisma.claimCode.create({ data: { ...r, letterBatch: name, variantCell: "A", town: "Holmfirth", createdAt: daysAgo(uploadedDaysAgo), mailingAddress: "1 High St\nHolmfirth\nHD9 2TT", reservedUntil: daysOn(20) } });
    }
  }

  it("counts non-responders on the batch, and gives their file from day 10", async () => {
    await batch("OLD", 12);
    await batch("NEW", 3);
    const list = await call(batches);
    const byName = Object.fromEntries(list.body.items.map((b: { name: string; unclaimed: number; secondLetterFrom: string }) => [b.name, b]));
    expect(byName.OLD).toMatchObject({ codes: 4, claimed: 1, suppressed: 1, unclaimed: 2 });
    expect(byName.NEW.unclaimed).toBe(2);
    expect(byName.NEW.secondLetterFrom > byName.OLD.secondLetterFrom).toBe(true);

    const second = await call(mailHouse, { params: { batch: "OLD" }, query: { second: "1" } });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ batch: "OLD", second: true, suppressed: 1, responded: 1 });
    expect(second.body.rows.map((r: { code: string }) => r.code)).toEqual(["OLD-C", "OLD-D"]);
    expect((await call(mailHouse, { params: { batch: "OLD" } })).body.rows).toHaveLength(3);
    const early = await call(mailHouse, { params: { batch: "NEW" }, query: { second: "1" } });
    expect(early.status).toBe(409);
    expect(early.body.error.message).toMatch(/10 to 14 days/);
  });
});
