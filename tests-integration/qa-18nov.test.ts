import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as detail } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { POST as decide } from "@/app/api/admin/v1/verifications/[engineerId]/decision/route";
import { POST as cardDetails } from "@/app/api/admin/v1/verifications/[engineerId]/card-details/route";
import { GET as engineers } from "@/app/api/admin/v1/engineers/route";
import { sendPushNotification } from "@/lib/push";
import { call, CHECKER, resetDb } from "./helpers";
import { makeEngineer } from "./factories";

vi.mock("@vercel/blob", () => ({ del: vi.fn(), put: vi.fn(), get: vi.fn(async () => null) }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: vi.fn(), smsConfigured: () => true, cancelScheduledSms: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(), emailConfigured: () => true }));
vi.mock("@/lib/installer-leaves", () => ({ offerNearbyEngineers: vi.fn(async () => ({ offered: 0 })) }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

const CARD = "https://x.private.blob.vercel-storage.com/gas-safe-cards/card-a1.jpg";
const LIVE_SINCE = new Date("2026-09-30T09:00:00Z");
const REGISTER_CHECKED = new Date("2026-10-01T09:00:00Z");

const reopened = (data: Parameters<typeof makeEngineer>[0] = {}) =>
  makeEngineer(
    {
      gasSafeCardUrl: CARD,
      gasSafeNo: "1234567",
      gasSafeRegistrationNo: "584123",
      gasSafeReopenedAt: new Date("2026-11-19T08:00:00Z"),
      gasSafeReviewRequestedAt: new Date("2026-11-19T08:00:00Z"),
      gasSafeVerifiedBeforeReopenAt: LIVE_SINCE,
      gasSafeRegisterCheckedBeforeReopenAt: REGISTER_CHECKED,
      ...data,
    },
    { cardRead: false },
  );

async function pass(e: { id: string; firstName: string | null; lastName: string | null }, registrationNo = "584123") {
  const typed = await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { licenceNo: "1234567", registrationNo, name: `${e.firstName} ${e.lastName}`, expiresOn: "2027-06-30", categories: [] } });
  expect(typed.status).toBe(200);
  const view = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
  return call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", revision: view.revision, ...(view.card.concerns?.length ? { reason: "Checked on the register by hand" } : {}) } });
}

describe("an engineer migration 0052 took off live (M-11)", () => {
  it("is not live, waits from the reopen, and says why in the history", async () => {
    const e = await reopened();
    await prisma.event.create({ data: { name: "gas_safe_card_check_reopened", actorType: "SYSTEM", meta: { engineerId: e.id, via: "migration 0052" } } });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d).toMatchObject({ stage: "card", waitingSince: "2026-11-19T08:00:00.000Z" });
    expect(d.history[0]).toMatchObject({ kind: "reopened" });
    const list = await call(engineers, { query: { status: "not_live" } });
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(e.id);
  });

  it("goes live again on its original dates when the card passes, and is told it's live again", async () => {
    const e = await reopened();
    expect((await pass(e)).status).toBe(200);
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ gasSafeVerifiedAt: LIVE_SINCE, gasSafeRegisterCheckedAt: REGISTER_CHECKED, gasSafeReopenedAt: null, gasSafeVerifiedBeforeReopenAt: null, gasSafeRegisterCheckedBeforeReopenAt: null });
    expect(row.gasSafeCardReadId).not.toBeNull();
    await vi.waitFor(() => expect(sendPushNotification).toHaveBeenCalledWith(e.id, "You're live again", expect.any(String), expect.anything()));
    expect(sendPushNotification).not.toHaveBeenCalledWith(e.id, "You're live", expect.any(String), expect.anything());
  });

  it("keeps a re-check it clears, and its reason, in the reopen event (N-11)", async () => {
    const asked = new Date("2026-11-10T09:00:00Z");
    const e = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeVerifiedAt: LIVE_SINCE, gasSafeRecheckRequestedAt: asked, gasSafeRecheckReason: "New card uploaded" }, { cardRead: false });
    const sql = readFileSync("prisma/migrations/0052_card_check_reopen/migration.sql", "utf8");
    for (const statement of sql.split(";").map((st) => st.replace(/^--.*$/gm, "").trim())) {
      if (/^(INSERT INTO "Event"|UPDATE "Engineer")/.test(statement)) await prisma.$executeRawUnsafe(statement);
    }
    expect(await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).toMatchObject({ gasSafeVerifiedAt: null, gasSafeVerifiedBeforeReopenAt: LIVE_SINCE, gasSafeRecheckRequestedAt: null, gasSafeRecheckReason: null });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: `reopen-0052-${e.id}` } });
    expect(event.meta).toMatchObject({ engineerId: e.id, recheckRequestedAt: "2026-11-10T09:00:00", recheckReason: "New card uploaded" });
  });

  it("needs the register check again when the card's registration number isn't the one checked", async () => {
    const e = await reopened();
    expect((await pass(e, "584124")).status).toBe(200);
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeVerifiedAt).toEqual(LIVE_SINCE);
    expect(row.gasSafeRegisterCheckedAt).toBeNull();
  });
});

describe("card details a person types in (M-01, M-02, N-04, R-01, R-03)", () => {
  it("refuse a placeholder name and an expiry no Gas Safe card has, and take a shorter registration number", async () => {
    const e = await reopened();
    const body = { licenceNo: "1234567", registrationNo: "584123", name: "Not given", expiresOn: "2027-06-30", categories: [] };
    expect((await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body })).status).toBe(400);
    for (const name of ["Not provided", "TBC", "See card", "Mr"]) expect((await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { ...body, name } })).status).toBe(400);
    expect((await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { ...body, name: "Dave Smith", expiresOn: "2099-12-31" } })).status).toBe(400);
    expect((await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { ...body, name: "Dave Smith", registrationNo: "50134" } })).status).toBe(200);
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.card.concerns).toEqual(expect.arrayContaining([expect.stringMatching(/shorter than the usual 6 digits/)]));
  });

  it("take a real name as printed, however much it sounds like a placeholder, and a stand-in name a person has checked (R-01, R-03)", async () => {
    const body = { licenceNo: "1234567", registrationNo: "584123", expiresOn: "2027-06-30", categories: [] };
    const e = await reopened();
    for (const name of ["Shay Given", "SHAY GIVEN", "Andrew Card", "Steve Blank", "Nil Yılmaz", "John Doe"]) {
      expect((await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { ...body, name } })).status).toBe(200);
      expect((await prisma.gasSafeCardRead.findFirstOrThrow({ where: { engineerId: e.id, source: "checker" }, orderBy: { createdAt: "desc" } })).name).toBe(name);
      const concerns: string[] = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body.card.concerns;
      expect(concerns.some((c) => /stand-in/.test(c))).toBe(name === "John Doe");
    }
    for (const name of ["Unable to read", "Cardholder", "Gas Safe Engineer", "XXXX", "n.a."]) expect((await call(cardDetails, { as: CHECKER, params: { engineerId: e.id }, body: { ...body, name } })).status).toBe(400);
  });
});
