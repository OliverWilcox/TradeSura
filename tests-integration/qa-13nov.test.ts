import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as engineers } from "@/app/api/admin/v1/engineers/route";
import { GET as detail } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { POST as decide } from "@/app/api/admin/v1/verifications/[engineerId]/decision/route";
import { POST as registerCheck } from "@/app/api/admin/v1/verifications/[engineerId]/register-check/route";
import { POST as cardDetails } from "@/app/api/admin/v1/verifications/[engineerId]/card-details/route";
import { POST as cardRead } from "@/app/api/admin/v1/verifications/[engineerId]/card-read/route";
import { POST as posted } from "@/app/api/admin/v1/member-packs/posted/route";
import { GET as followUps } from "@/app/api/admin/v1/follow-ups/route";
import { GET as customers } from "@/app/api/admin/v1/customers/route";
import { deleteOwnerAccount } from "@/lib/delete-account";
import { badgePublic } from "@/lib/verification-state";
import { call, CHECKER, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan, readCard } from "./factories";

const blob = vi.hoisted(() => ({ del: vi.fn(async () => {}) }));
vi.mock("@vercel/blob", () => ({ del: blob.del, put: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: vi.fn(), smsConfigured: () => true, cancelScheduledSms: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), emailConfigured: () => true }));
vi.mock("@/lib/installer-leaves", () => ({ offerNearbyEngineers: vi.fn(async () => ({ offered: 0 })) }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

const CARD = "https://x.public.blob.vercel-storage.com/card.png";
const LIVE_SINCE = new Date("2026-10-01T09:00:00Z");
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id).sort();

async function markedLiveUnread(data: Parameters<typeof makeEngineer>[0] = {}) {
  return makeEngineer({ gasSafeCardUrl: CARD, gasSafeNo: "1234567", gasSafeRegistrationNo: "584123", gasSafeVerifiedAt: LIVE_SINCE, ...data }, { cardRead: false });
}

describe("live and not live", () => {
  it("between them cover every engineer, a fully read card waiting for a person among the not live", async () => {
    const live = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeVerifiedAt: LIVE_SINCE });
    const waiting = await makeEngineer({ gasSafeCardUrl: CARD });
    await readCard(waiting.id);
    const unread = await markedLiveUnread();
    const fresh = await makeEngineer();
    expect(ids(await call(engineers, { query: { status: "live" } }))).toEqual([live.id]);
    expect(ids(await call(engineers, { query: { status: "not_live" } }))).toEqual([waiting.id, unread.id, fresh.id].sort());
  });

  it("keeps the public badge off an engineer marked live before cards were read", async () => {
    const unread = await markedLiveUnread({ gasSafeRegisterCheckedAt: LIVE_SINCE });
    expect(badgePublic(unread)).toBe(false);
  });
});

describe("an engineer marked live before cards were read", () => {
  it("isn't passed by entering the card's details: a person still passes it, and a register check on the same numbers stands", async () => {
    const e = await markedLiveUnread({ gasSafeRegisterCheckedAt: LIVE_SINCE });
    const d = await call(detail, { as: CHECKER, params: { engineerId: e.id } });
    expect(d.body).toMatchObject({ stage: "card", checks: { liveSince: null } });
    await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { licenceNo: "1234567", registrationNo: "584123", name: `${e.firstName} ${e.lastName}`, expiresOn: "2027-06-30", categories: [] } });
    const after = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(after.stage).toBe("card");
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeCardReadId).toBeNull();
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", revision: after.revision } })).status).toBe(200);
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeCardReadId).toBe(after.card.readId);
    expect(row.gasSafeVerifiedAt).toEqual(LIVE_SINCE);
    expect(row.gasSafeRegisterCheckedAt).toEqual(LIVE_SINCE);
  });

  it("goes back to the register check when the card's numbers differ from the ones checked", async () => {
    const e = await markedLiveUnread({ gasSafeRegisterCheckedAt: LIVE_SINCE });
    await readCard(e.id, { licenceNo: "7654321" });
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", reason: "Licence renewed" } })).status).toBe(200);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRegisterCheckedAt).toBeNull();
  });

  it("isn't counted on the call list, and their pack can't be marked posted", async () => {
    const e = await markedLiveUnread({ gasSafeRegisterCheckedAt: LIVE_SINCE, packRequestedAt: LIVE_SINCE, packAddress: "1 High Street\nLeeds\nLS1 4AB" });
    const calls = await call(followUps, { query: { tab: "calls" } });
    expect(calls.body.items.map((i: { id: string }) => i.id)).not.toContain(e.id);
    const res = await call(posted, { body: { engineerIds: [e.id] } });
    expect(res.body.posted).toEqual([]);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).packShippedAt).toBeNull();
  });
});

describe("gas categories", () => {
  it("aren't kept from a checker's entry when there's no photo of the back of the card", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD });
    await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { licenceNo: "1234567", registrationNo: "584123", name: `${e.firstName} ${e.lastName}`, expiresOn: "2027-06-30", categories: ["Boilers"] } });
    expect((await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body.card.details.categories).toEqual([]);
  });
});

describe("the reading the check is decided on", () => {
  it("stays the complete one when a later reading comes back worse", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeNo: "1234567", gasSafeRegistrationNo: "584123" });
    const good = await readCard(e.id, { createdAt: new Date("2026-11-10T09:00:00Z") });
    await readCard(e.id, { outcome: "error", complete: false, licenceNo: null, registrationNo: null, name: null, expiresOn: null, createdAt: new Date("2026-11-11T09:00:00Z") });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.card).toMatchObject({ readId: good.id, automatic: "waiting", details: { licenceNo: "1234567" } });
    expect(d.passBlocked).toBeNull();
  });

  it("can't be read again on a server without the automatic check", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD });
    const res = await call(cardRead, { as: CHECKER, params: { engineerId: e.id } });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/isn't set up/);
    expect(await prisma.gasSafeCardRead.count({ where: { engineerId: e.id } })).toBe(0);
  });
});

describe("a new card from a live engineer", () => {
  it("has to be read in full before the register check passes, and then becomes the card the check was passed on", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeVerifiedAt: LIVE_SINCE, gasSafeRegisterCheckedAt: LIVE_SINCE, gasSafeNo: "1234567" });
    const first = (await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeCardReadId;
    const NEW = "https://x.public.blob.vercel-storage.com/new-card.png";
    await prisma.engineer.update({ where: { id: e.id }, data: { gasSafeCardUrl: NEW, gasSafeRecheckRequestedAt: new Date(), gasSafeRecheckReason: "New card" } });
    await readCard(e.id, { outcome: "not_a_card", isGasSafeCard: false, complete: false, licenceNo: null, registrationNo: null, name: null, expiresOn: null });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d).toMatchObject({ stage: "recheck", card: { newCard: true }, registerSearch: { number: "1234567" } });
    expect(d.registerBlocked).toBeTruthy();
    expect((await call(registerCheck, { as: CHECKER, params: { engineerId: e.id }, body: { note: "Checked on the register" } })).status).toBe(409);
    const good = await readCard(e.id, { expiresOn: new Date("2027-09-30T00:00:00Z") });
    expect((await call(registerCheck, { as: CHECKER, params: { engineerId: e.id }, body: { note: "Checked on the register" } })).status).toBe(200);
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeCardReadId).toBe(good.id);
    expect(row.gasSafeCardReadId).not.toBe(first);
    expect(row.gasSafeCardExpiresOn).toEqual(new Date("2027-09-30T00:00:00Z"));
  });
});

describe("a limited company", () => {
  it("needs a note to pass when Companies House couldn't be asked for its officers", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeNo: "1234567", gasSafeRegistrationNo: "584123", businessType: "ltd", companyNumber: "12345678", legalName: "Smith Heating Ltd" });
    await readCard(e.id);
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.card.concerns.join(" ")).toMatch(/Companies House couldn't be asked/);
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } })).status).toBe(400);
  });
});

describe("deleting an account", () => {
  it("removes both card photos and every reading of them", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeCardBackUrl: "https://x.public.blob.vercel-storage.com/back.png", gasSafeVerifiedAt: LIVE_SINCE });
    await readCard(e.id, { cardUrl: "https://x.public.blob.vercel-storage.com/old.png" });
    expect(await deleteOwnerAccount(e.id)).toEqual({ ok: true });
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ gasSafeCardUrl: null, gasSafeCardBackUrl: null, gasSafeCardReadId: null });
    expect(await prisma.gasSafeCardRead.count({ where: { engineerId: e.id } })).toBe(0);
    expect(blob.del.mock.calls.map((c) => (c as unknown[])[0]).sort()).toEqual([CARD, "https://x.public.blob.vercel-storage.com/back.png", "https://x.public.blob.vercel-storage.com/old.png"].sort());
  });
});

describe("customers", () => {
  it("are filtered by their current plan, as the columns show it", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeVerifiedAt: LIVE_SINCE });
    const c = await makeCustomer(e.id);
    await makePlan(e.id, c.id, { status: "CANCELLED", billingInterval: "year", visitReason: "service_due", createdAt: new Date("2026-01-01"), cancelledAt: new Date("2026-03-01") });
    await makePlan(e.id, c.id, { status: "ACTIVE", billingInterval: "month", visitReason: "repair", createdAt: new Date("2026-04-01") });
    const rows = async (query: Record<string, string>) => (await call(customers, { query })).body.items.map((i: { id: string }) => i.id);
    expect(await rows({ pays: "monthly" })).toEqual([c.id]);
    expect(await rows({ pays: "yearly" })).toEqual([]);
    expect(await rows({ reason: "repair" })).toEqual([c.id]);
    expect(await rows({ reason: "service_due" })).toEqual([]);
  });
});
