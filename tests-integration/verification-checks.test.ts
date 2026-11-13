import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/verifications/route";
import { GET as detail } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { POST as decide } from "@/app/api/admin/v1/verifications/[engineerId]/decision/route";
import { POST as chase } from "@/app/api/admin/v1/verifications/[engineerId]/chase/route";
import { call, CHECKER, resetDb } from "./helpers";
import { makeEngineer } from "./factories";

// Section 3 of the client's feedback, and Matt's of 4 Nov: what the check page shows and asks for.

const sent = vi.hoisted(() => ({ push: vi.fn(), sms: vi.fn(async () => true), email: vi.fn(async () => {}) }));
// Whether texts and email are set up on this server (QA-05).
const configured = vi.hoisted(() => ({ sms: true, email: true }));
vi.mock("@/lib/push", () => ({ sendPushNotification: sent.push }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: sent.sms, smsConfigured: () => configured.sms }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email, emailConfigured: () => configured.email }));
// Companies House: Matt Wood's company, as the client saw it.
vi.mock("@/lib/companies-house", () => ({ companyOfficers: async () => [{ name: "WOOD, Matthew Dean", role: "director" }] }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  Object.assign(configured, { sms: true, email: true });
});

const CARD = "https://x.public.blob.vercel-storage.com/card.png";

/** A case with nothing left to check: a card, and nothing shared with another account. */
const cleanApplication = (data: Parameters<typeof makeEngineer>[0] = {}) => makeEngineer({ firstName: "Dave", lastName: "Smith", gasSafeCardUrl: CARD, ...data });

const isoDay = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("3.1: officer names", () => {
  it("calls Matt Wood a likely match for WOOD, Matthew Dean, not a missing officer", async () => {
    const e = await makeEngineer({ firstName: "Matt", lastName: "Wood", businessType: "ltd", companyNumber: "12345678", legalName: "302 MD LTD", tradingName: "302 MD LTD" });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.company.officers).toEqual([{ name: "WOOD, Matthew Dean", role: "director", match: "likely", matchesApplicant: true }]);
    expect(d.warnings.map((w: { code: string }) => w.code)).toContain("officer_likely");
    expect(d.warnings.map((w: { code: string }) => w.code)).not.toContain("no_officer");
  });
});

describe("3.2, 3.5: the queue", () => {
  it("shows the licence number and town, and waits from the latest card upload", async () => {
    const e = await cleanApplication({ town: "Huddersfield", gasSafeNo: "1234567", createdAt: new Date("2026-10-20T09:00:00Z") });
    await prisma.event.create({ data: { name: "gas_safe_card_added", actorType: "ENGINEER", actorId: e.id, ts: new Date("2026-10-22T09:00:00Z") } });
    const [row] = (await call(list, { as: CHECKER })).body.items;
    expect(row).toMatchObject({ licenceNo: "1234567", town: "Huddersfield", submittedAt: "2026-10-20T09:00:00.000Z", waitingSince: "2026-10-22T09:00:00.000Z" });
  });
});

describe("Matt, 4 Nov: only the live register", () => {
  it("never checks a stored copy, whatever it holds", async () => {
    await prisma.gasSafeRecord.create({ data: { regNo: "999999", name: "Someone Else", company: "Other Ltd", categories: "Boilers" } });
    const e = await cleanApplication({ gasSafeNo: "999999" });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.warnings).toEqual([]);
    expect(Object.keys(d.gasSafe).sort()).toEqual(["licenceNo", "registerUrl", "registrationNo"]);
    expect(d.gasSafe.registerUrl).toMatch(/^https:\/\/www\.gassaferegister\.co\.uk/);
  });

  it("flags a card expiry more than 13 months away", async () => {
    const e = await cleanApplication({ gasSafeCardExpiresOn: new Date(`${isoDay(500)}T00:00:00Z`) });
    expect((await call(list, { as: CHECKER })).body.items[0].signals.cardExpiryFar).toBe(true);
    expect((await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body.warnings.map((w: { code: string }) => w.code)).toEqual(["card_expiry_far"]);
    const normal = await cleanApplication({ lastName: "Hughes", gasSafeCardExpiresOn: new Date(`${isoDay(300)}T00:00:00Z`) });
    expect((await call(detail, { as: CHECKER, params: { engineerId: normal.id } })).body.warnings).toEqual([]);
  });
});

describe("3.4: business type", () => {
  it("flags a company name on a sole trader, in the queue and on the case", async () => {
    const e = await cleanApplication({ tradingName: "Test Trading LTD", businessType: "sole_trader" });
    expect((await call(list, { as: CHECKER })).body.items[0].signals.typeMismatch).toBe("name_says_company");
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    // No Companies House key here, so no search results: the flag stands on its own.
    expect(d.typeMismatch).toEqual({ kind: "name_says_company", search: null });
    expect(d.warnings.map((w: { code: string }) => w.code)).toContain("type_mismatch");
  });
});

describe("3.6: the check page", () => {
  it("sets out what they gave, and shows contact details only to admins who may see them", async () => {
    const e = await cleanApplication({ gasSafeCategories: "Domestic gas, LPG", town: "Leeds" });
    const checker = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(checker.submitted).toEqual({ name: "Dave Smith", business: e.tradingName, categories: "Domestic gas, LPG", postcode: "LS1 4AB", town: "Leeds", cardExpiry: null });
    expect(checker.contact).toBeNull();
    const admin = (await call(detail, { params: { engineerId: e.id } })).body;
    expect(admin.contact.email).toMatch(/•••/);
  });
  it("chases a missing card photo by text, and records it", async () => {
    const e = await makeEngineer({ setupTextConsentAt: new Date() });
    const res = await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "sms" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chased: true, channel: "sms", notSent: null });
    expect(sent.sms).toHaveBeenCalledWith(e.id, expect.stringContaining("photo of your Gas Safe ID card"));
    expect(await prisma.event.findFirst({ where: { name: "verification_chased" } })).toMatchObject({ actorType: "ADMIN", meta: expect.objectContaining({ what: "photo", channel: "sms" }) });
  });

  it("won't text a chase to someone who hasn't agreed to setup texts, but will email", async () => {
    const e = await makeEngineer();
    const text = await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "sms" } });
    expect(text.status).toBe(409);
    expect(sent.sms).not.toHaveBeenCalled();
    expect((await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "email" } })).status).toBe(200);
    expect(sent.email).toHaveBeenCalledOnce();
  });

  it("says a chase didn't go, and why, and records the attempt instead of a chase (QA-05)", async () => {
    const e = await makeEngineer({ setupTextConsentAt: new Date() });
    configured.sms = false;
    sent.sms.mockResolvedValueOnce(false);
    const text = await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "sms" } });
    expect(text.body).toEqual({ chased: false, channel: "sms", notSent: "not_configured" });
    sent.email.mockRejectedValueOnce(new Error("Failed to send email: rate limited"));
    const email = await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "email" } });
    expect(email.body).toEqual({ chased: false, channel: "email", notSent: "refused" });
    // Email not set up: the dev driver only printed it.
    configured.email = false;
    expect((await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "details", channel: "email" } })).body).toMatchObject({ chased: false, notSent: "not_configured" });
    expect(await prisma.event.count({ where: { name: "verification_chase_failed" } })).toBe(3);
    expect(await prisma.event.count({ where: { name: "verification_chased" } })).toBe(0);
  });

  it("won't chase an application that's been decided", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date() });
    expect((await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "email" } })).status).toBe(409);
    expect(sent.email).not.toHaveBeenCalled();
  });
});

describe("3.7: passing the card check over open warnings", () => {
  it("needs a note, kept with the decision and the warnings it was made over", async () => {
    const e = await cleanApplication({ gasSafeCardExpiresOn: new Date(`${isoDay(500)}T00:00:00Z`) });
    const without = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(without.status).toBe(400);
    expect(without.body.error.fields.reason).toBeDefined();
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeVerifiedAt).toBeNull();

    const withNote = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", reason: "Saw the card on a video call" } });
    expect(withNote.status).toBe(200);
    const event = await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_verified" } });
    expect(event.meta).toMatchObject({ reason: "Saw the card on a video call", warnings: ["card_expiry_far"] });
  });

  it("needs no note when nothing is open", async () => {
    const e = await cleanApplication();
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.warnings).toEqual([]);
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } })).status).toBe(200);
  });
});
