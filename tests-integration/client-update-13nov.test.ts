import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as funnel } from "@/app/api/admin/v1/dashboard/engineer-funnel/route";
import { GET as customers } from "@/app/api/admin/v1/customers/route";
import { GET as customer } from "@/app/api/admin/v1/customers/[customerId]/route";
import { GET as packs } from "@/app/api/admin/v1/member-packs/route";
import { POST as uploadCard } from "@/app/api/settings/gas-safe-card/route";
import { yearlyRefundSplit } from "@/lib/admin/customers";
import { call, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan, readCard, TEST_CARD_JPEG } from "./factories";

const session = vi.hoisted(() => ({ engineerId: null as string | null }));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), getEngineerId: async () => session.engineerId }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(async (path: string) => ({ url: `https://x.private.blob.vercel-storage.com/${path}-${Math.random().toString(36).slice(2)}` })), get: vi.fn(async () => null), del: vi.fn() }));
vi.mock("@/lib/card-alert", () => ({ queueCardAlert: vi.fn(async () => {}) }));

beforeEach(async () => {
  await resetDb();
  session.engineerId = null;
});

const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));
const OCTOBER = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };

describe("the funnel's letters", () => {
  async function batches() {
    await prisma.letterBatch.create({ data: { name: "Leeds October", area: "Leeds", postedOn: new Date("2026-10-05T00:00:00Z"), letters: 2 } });
    await prisma.letterBatch.create({ data: { name: "York September", area: "York", postedOn: new Date("2026-09-25T00:00:00Z"), letters: 1 } });
    await prisma.claimCode.createMany({
      data: [
        { code: "LEEDS-A2B3", firstName: "A", businessName: "A Gas", letterBatch: "Leeds October", variantCell: "A", town: "Leeds", createdAt: new Date("2026-09-28T12:00:00Z") },
        { code: "LEEDS-C4D5", firstName: "B", businessName: "B Gas", letterBatch: "Leeds October", variantCell: "A", town: "Wakefield", createdAt: new Date("2026-09-28T12:00:00Z") },
        { code: "YORK-E6F7", firstName: "C", businessName: "C Gas", letterBatch: "York September", variantCell: "A", town: "York", createdAt: new Date("2026-10-02T12:00:00Z") },
        { code: "TS-OLD1", firstName: "D", businessName: "D Gas", letterBatch: "2026-10-A", variantCell: "A", town: "Leeds", createdAt: day(3) },
      ],
    });
  }

  it("counts a batch's letters by the date they were posted, and old batches by when their codes were made", async () => {
    await batches();
    const res = await call(funnel, { query: OCTOBER });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ letters: 3, batches: 2 });
    expect(res.body.steps[0]).toMatchObject({ key: "letters_posted", count: 3 });
    expect(res.body.options.batches.map((b: { name: string }) => b.name).sort()).toEqual(["2026-10-A", "Leeds October", "York September"]);
    expect(res.body.options.towns).toEqual(["Leeds", "Wakefield", "York"]);
  });

  it("filters by batch, town, one code and the visit reason of the first offer", async () => {
    await batches();
    expect((await call(funnel, { query: { ...OCTOBER, batch: "Leeds October" } })).body.letters).toBe(2);
    expect((await call(funnel, { query: { ...OCTOBER, town: "leeds" } })).body.letters).toBe(2);
    expect((await call(funnel, { query: { ...OCTOBER, code: "leeds-c4d5" } })).body.letters).toBe(1);

    const e = await makeEngineer({ gasSafeVerifiedAt: day(8), gasSafeCardUrl: "https://x/card.jpg" });
    await prisma.claimCode.update({ where: { code: "LEEDS-A2B3" }, data: { redeemedByEngineerId: e.id, redeemedAt: day(7), claimedAt: day(6) } });
    for (const [s, d] of [["scan", 5], ["form_completed", 6], ["store_opened", 6]] as const) {
      await prisma.event.create({ data: { name: "claim_step", actorType: "SYSTEM", ts: day(d), meta: { code: "LEEDS-A2B3", step: s } } });
    }
    await prisma.event.create({ data: { name: "gas_safe_card_added", actorType: "ENGINEER", actorId: e.id, ts: day(7) } });
    const c = await makeCustomer(e.id);
    const p = await makePlan(e.id, c.id, { activatedAt: day(15), linkOpenedAt: day(14), visitReason: "yearly_service" });
    await prisma.event.create({ data: { name: "offer_sent", actorType: "ENGINEER", actorId: e.id, ts: day(14), meta: { planId: p.id, customerId: c.id, channel: "sms" } } });
    const step = (body: { steps: { key: string; count: number | null }[] }, key: string) => body.steps.find((s) => s.key === key)?.count;
    const forService = (await call(funnel, { query: { ...OCTOBER, reason: "yearly_service" } })).body;
    const forRepair = (await call(funnel, { query: { ...OCTOBER, reason: "breakdown" } })).body;
    expect(step(forService, "card_check_passed")).toBe(1);
    expect(step(forService, "first_customer")).toBe(0);
    expect(step(forRepair, "signed_up")).toBe(1);
    expect(step(forRepair, "first_offer")).toBe(0);
  });
});

describe("customers", () => {
  it("filter by visit reason and by how they pay, and show which", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: day(1) });
    const yearly = await makeCustomer(e.id);
    const monthly = await makeCustomer(e.id);
    await makePlan(e.id, yearly.id, { billingInterval: "year", visitReason: "yearly_service" });
    await makePlan(e.id, monthly.id, { visitReason: "breakdown" });
    const ids = async (query: Record<string, string>) => (await call(customers, { query })).body.items.map((i: { id: string }) => i.id);
    expect(await ids({ pays: "yearly" })).toEqual([yearly.id]);
    expect(await ids({ pays: "monthly" })).toEqual([monthly.id]);
    expect(await ids({ reason: "breakdown" })).toEqual([monthly.id]);
    const all = (await call(customers)).body;
    expect(new Map(all.items.map((i: { id: string; pays: string }) => [i.id, i.pays]))).toEqual(new Map([[yearly.id, "yearly"], [monthly.id, "monthly"]]));
    expect(Array.isArray(all.filters.reasons)).toBe(true);
  });

  it("show a yearly cancellation's refund coming from the engineer's share, TradeSura keeping its 20%", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: day(1) });
    const c = await makeCustomer(e.id);
    const p = await makePlan(e.id, c.id, { billingInterval: "year", stripeSubscriptionId: "sub_year", activatedAt: new Date("2026-01-10T12:00:00Z"), status: "CANCELLED", cancelledAt: new Date("2026-04-15T12:00:00Z") });
    await prisma.stripeWebhookEvent.create({
      data: {
        id: "evt_year",
        type: "invoice.paid",
        processedAt: new Date("2026-01-24T12:00:00Z"),
        payload: { data: { object: { id: "in_year", amount_paid: 16500, application_fee_amount: 3300, subscription: "sub_year", status_transitions: { paid_at: Date.UTC(2026, 0, 24, 12) / 1000 } } } },
      },
    });
    await prisma.event.create({ data: { name: "yearly_refund", actorType: "SYSTEM", ts: new Date("2026-04-15T12:05:00Z"), meta: { planId: p.id, unusedMonths: 9, amountPence: 12375, feeKept: true } } });
    const plan = (await call(customer, { params: { customerId: c.id } })).body.plans[0];
    expect(plan.refund).toEqual({
      status: "refunded",
      at: "2026-04-15T12:05:00.000Z",
      paidPence: 16500,
      feePence: 3300,
      unusedMonths: 9,
      refundPence: 12375,
      feeRefundedPence: 0,
      feeKeptPence: 3300,
      fromEngineerPence: 12375,
      engineerKeepsPence: 825,
    });
  });

  it("work out a refund still to come, and say how much of an older refund gave back the fee", () => {
    const paid = [{ amountPence: 12000, feePence: 2400, paidAt: new Date("2026-02-10T12:00:00Z") }];
    const ending = { billingInterval: "year", cancelledAt: null, cancelEffectiveAt: new Date("2026-05-20T12:00:00Z") };
    const due = yearlyRefundSplit(ending, paid, null, new Date("2026-05-19T12:00:00Z"));
    expect(due).toMatchObject({ status: "due", unusedMonths: 8, refundPence: 8000, feeRefundedPence: 0, feeKeptPence: 2400, fromEngineerPence: 8000, engineerKeepsPence: 1600 });
    expect(yearlyRefundSplit(ending, paid, null, new Date("2026-06-01T12:00:00Z"))).toMatchObject({ status: "not_recorded", refundPence: 8000 });
    expect(yearlyRefundSplit({ ...ending, cancelEffectiveAt: new Date("2027-02-10T12:00:00Z") }, paid, null, new Date("2026-05-19T12:00:00Z"))).toBeNull();
    const early = yearlyRefundSplit({ ...ending, cancelEffectiveAt: new Date("2026-02-20T12:00:00Z") }, paid, null, new Date("2026-02-20T13:00:00Z"));
    expect(early).toMatchObject({ unusedMonths: 11, refundPence: 11000, fromEngineerPence: 11000, engineerKeepsPence: -1400 });
    const coolingOff = yearlyRefundSplit({ ...ending, cancelEffectiveAt: new Date("2026-02-15T12:00:00Z"), coolingOffEndsAt: new Date("2026-02-24T12:00:00Z") }, paid, null);
    expect(coolingOff).toMatchObject({ status: "cooling_off", refundPence: 12000, feeRefundedPence: 2400, feeKeptPence: 0, fromEngineerPence: 9600, engineerKeepsPence: 0 });
    const before = yearlyRefundSplit({ billingInterval: "year", cancelledAt: new Date("2026-05-20T12:00:00Z"), cancelEffectiveAt: null }, paid, { ts: new Date("2026-05-20T12:00:00Z"), meta: { amountPence: 8000, unusedMonths: 8 } });
    expect(before).toMatchObject({ feeRefundedPence: 1600, feeKeptPence: 800, fromEngineerPence: 6400, engineerKeepsPence: 3200 });
    expect(yearlyRefundSplit({ billingInterval: "month", cancelledAt: new Date(), cancelEffectiveAt: null }, paid, null)).toBeNull();
  });
});

describe("held member packs", () => {
  it("say why each one is held", async () => {
    const requested = { packAddress: "1 High Street\nLeeds\nLS1 4AB", packRequestedAt: new Date("2026-10-01") };
    const noCard = await makeEngineer(requested);
    const waiting = await makeEngineer({ ...requested, gasSafeCardUrl: "https://x/card.jpg" });
    const marked = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date(), gasSafeCardUrl: "https://x/card.jpg" }, { cardRead: false });
    const failed = await makeEngineer({ ...requested, gasSafeRejectedAt: new Date(), gasSafeCardUrl: "https://x/card.jpg" });
    const due = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date() });
    const res = await call(packs, { query: { tab: "held" } });
    expect(Object.fromEntries(res.body.items.map((i: { id: string; heldBecause: string }) => [i.id, i.heldBecause]))).toEqual({
      [noCard.id]: "no_card",
      [waiting.id]: "card_check",
      [marked.id]: "card_check",
      [failed.id]: "card_failed",
      [due.id]: "register_check_due",
    });
  });
});

describe("a card photo from the app", () => {
  it("is read by the automatic check straight after it's saved, with the back when there is one", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: null });
    session.engineerId = e.id;
    const photo = { base64: TEST_CARD_JPEG, mimeType: "image/jpeg" };
    const res = await uploadCard(new Request("http://localhost:3000/api/settings/gas-safe-card", { method: "POST", body: JSON.stringify({ ...photo, back: photo }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeCardUrl).toMatch(/^https:\/\/x\.private\.blob\.vercel-storage\.com\/gas-safe-cards\/card\.jpg-/);
    expect(row.gasSafeCardBackUrl).toMatch(/^https:\/\/x\.private\.blob\.vercel-storage\.com\//);
    const read = await prisma.gasSafeCardRead.findFirstOrThrow({ where: { engineerId: e.id } });
    expect(read).toMatchObject({ source: "automatic", outcome: "not_set_up", complete: false, cardUrl: row.gasSafeCardUrl, backUrl: row.gasSafeCardBackUrl });
    expect(row.gasSafeVerifiedAt).toBeNull();
  });

  it("from an older build, with no back, still goes in and clears an old back photo", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: "https://x.public.blob.vercel-storage.com/old.jpg", gasSafeCardBackUrl: "https://x.public.blob.vercel-storage.com/old-back.jpg" });
    session.engineerId = e.id;
    const res = await uploadCard(new Request("http://localhost:3000/api/settings/gas-safe-card", { method: "POST", body: JSON.stringify({ base64: TEST_CARD_JPEG, mimeType: "image/jpeg" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeCardBackUrl).toBeNull();
  });
});

describe("a card's front and back sent together", () => {
  it("are refused before either is kept when they're over 3 MB in all, so the request fits Vercel's 4.5 MB (R-04)", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: null });
    session.engineerId = e.id;
    const side = { base64: Buffer.alloc(1.6 * 1024 * 1024).toString("base64"), mimeType: "image/jpeg" };
    const res = await uploadCard(new Request("http://localhost:3000/api/settings/gas-safe-card", { method: "POST", body: JSON.stringify({ ...side, back: side }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The two photos are too big together. Keep them under 3 MB in all.", field: "back" });
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeCardUrl).toBeNull();
  });
});

describe("a card upload that isn't a photo", () => {
  it("is refused, and nothing is kept", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: null });
    session.engineerId = e.id;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString("base64");
    const res = await uploadCard(new Request("http://localhost:3000/api/settings/gas-safe-card", { method: "POST", body: JSON.stringify({ base64: svg, mimeType: "image/png" }), headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(400);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeCardUrl).toBeNull();
  });
});

describe("a read card on someone already live", () => {
  it("doesn't take them back through the card check when they upload a new card", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: day(1), gasSafeRegisterCheckedAt: day(2), gasSafeCardUrl: "https://x.public.blob.vercel-storage.com/old.jpg" });
    await readCard(e.id);
    session.engineerId = e.id;
    await uploadCard(new Request("http://localhost:3000/api/settings/gas-safe-card", { method: "POST", body: JSON.stringify({ base64: TEST_CARD_JPEG, mimeType: "image/jpeg" }), headers: { "content-type": "application/json" } }));
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeVerifiedAt).not.toBeNull();
    expect(row.gasSafeRecheckRequestedAt).not.toBeNull();
  });
});
