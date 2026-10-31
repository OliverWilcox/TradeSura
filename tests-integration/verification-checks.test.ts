import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/verifications/route";
import { GET as detail } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { POST as decide } from "@/app/api/admin/v1/verifications/[engineerId]/decision/route";
import { POST as chase } from "@/app/api/admin/v1/verifications/[engineerId]/chase/route";
import { call, CHECKER, resetDb } from "./helpers";
import { makeEngineer } from "./factories";

// Section 3 of the client's feedback: what the check page shows and asks for.

const sent = vi.hoisted(() => ({ push: vi.fn(), sms: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotification: sent.push }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: sent.sms }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email }));
// Companies House: Matt Wood's company, as the client saw it.
vi.mock("@/lib/companies-house", () => ({ companyOfficers: async () => [{ name: "WOOD, Matthew Dean", role: "director" }] }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

/** An application with nothing left to check: on the register by the same name, with a card. */
async function cleanApplication(data: Parameters<typeof makeEngineer>[0] = {}) {
  const e = await makeEngineer({ firstName: "Dave", lastName: "Smith", gasSafeCardUrl: "https://x.public.blob.vercel-storage.com/card.png", ...data });
  await prisma.gasSafeRecord.create({ data: { regNo: e.gasSafeNo!, name: "D. Smith", company: "Smith Heating", categories: "Domestic gas" } });
  return e;
}

describe("3.1: officer and register names", () => {
  it("calls Matt Wood a likely match for WOOD, Matthew Dean, not a missing officer", async () => {
    const e = await makeEngineer({ firstName: "Matt", lastName: "Wood", businessType: "ltd", companyNumber: "12345678", legalName: "302 MD LTD", tradingName: "302 MD LTD" });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.company.officers).toEqual([{ name: "WOOD, Matthew Dean", role: "director", match: "likely", matchesApplicant: true }]);
    expect(d.warnings.map((w: { code: string }) => w.code)).toContain("officer_likely");
    expect(d.warnings.map((w: { code: string }) => w.code)).not.toContain("no_officer");
  });

  it("calls a full name on the register a likely match for its short form", async () => {
    const e = await makeEngineer({ firstName: "Matt", lastName: "Wood" });
    await prisma.gasSafeRecord.create({ data: { regNo: e.gasSafeNo!, name: "Matthew Wood", company: "", categories: "" } });
    expect((await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body.gasSafe.register).toBe("likely_match");
  });
});

describe("3.2, 3.5: the queue", () => {
  it("shows the Gas Safe number and town, and waits from the latest card upload", async () => {
    const e = await makeEngineer({ town: "Huddersfield", createdAt: new Date("2026-10-20T09:00:00Z") });
    await prisma.event.create({ data: { name: "gas_safe_card_added", actorType: "ENGINEER", actorId: e.id, ts: new Date("2026-10-22T09:00:00Z") } });
    const [row] = (await call(list, { as: CHECKER })).body.items;
    expect(row).toMatchObject({ gasSafeNo: e.gasSafeNo, town: "Huddersfield", submittedAt: "2026-10-20T09:00:00.000Z", waitingSince: "2026-10-22T09:00:00.000Z" });
  });
});

describe("3.3: our copy of the register", () => {
  it("says how big it is and when it was imported, if that's recorded", async () => {
    const e = await makeEngineer();
    let copy = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body.gasSafe.copy;
    expect(copy).toEqual({ records: 0, importedAt: null });
    await prisma.appSetting.create({ data: { key: "gas_safe_register_imported_at", value: "2026-09-01T00:00:00.000Z" } });
    copy = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body.gasSafe.copy;
    expect(copy.importedAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("3.4: business type", () => {
  it("flags a company name on a sole trader, in the queue and on the case", async () => {
    const e = await makeEngineer({ tradingName: "Test Trading LTD", businessType: "sole_trader" });
    expect((await call(list, { as: CHECKER })).body.items[0].signals.typeMismatch).toBe("name_says_company");
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    // No Companies House key here, so no search results: the flag stands on its own.
    expect(d.typeMismatch).toEqual({ kind: "name_says_company", search: null });
    expect(d.warnings.map((w: { code: string }) => w.code)).toContain("type_mismatch");
  });
});

describe("3.6: the check page", () => {
  it("sets what they gave beside the register, and shows contact details only to admins who may see them", async () => {
    const e = await cleanApplication({ gasSafeCategories: "Domestic gas, LPG", town: "Leeds" });
    const checker = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(checker.submitted).toEqual({ name: "Dave Smith", business: e.tradingName, categories: "Domestic gas, LPG", postcode: "LS1 4AB", town: "Leeds", cardExpiry: null });
    expect(checker.gasSafe.onRegister).toEqual({ name: "D. Smith", company: "Smith Heating", categories: "Domestic gas" });
    expect(checker.contact).toBeNull();
    const admin = (await call(detail, { params: { engineerId: e.id } })).body;
    expect(admin.contact.email).toMatch(/•••/);
  });

  it("chases a missing card photo by text, and records it", async () => {
    const e = await makeEngineer();
    const res = await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "sms" } });
    expect(res.status).toBe(200);
    expect(sent.sms).toHaveBeenCalledWith(e.id, expect.stringContaining("photo of your Gas Safe ID card"));
    expect(await prisma.event.findFirst({ where: { name: "verification_chased" } })).toMatchObject({ actorType: "ADMIN", meta: expect.objectContaining({ what: "photo", channel: "sms" }) });
  });

  it("won't chase an application that's been decided", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date() });
    expect((await call(chase, { as: CHECKER, params: { engineerId: e.id }, body: { what: "photo", channel: "email" } })).status).toBe(409);
    expect(sent.email).not.toHaveBeenCalled();
  });
});

describe("3.7: approving over open warnings", () => {
  it("needs a note, kept with the decision and the warnings it was made over", async () => {
    const e = await makeEngineer(); // no card photo, not on the register
    const without = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(without.status).toBe(400);
    expect(without.body.error.fields.reason).toBeDefined();
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeVerifiedAt).toBeNull();

    const withNote = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", reason: "Saw the card on a video call" } });
    expect(withNote.status).toBe(200);
    const event = await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_verified" } });
    expect(event.meta).toMatchObject({ reason: "Saw the card on a video call", warnings: ["not_on_register", "no_card"] });
  });

  it("needs no note when nothing is open", async () => {
    const e = await cleanApplication();
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d.warnings).toEqual([]);
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } })).status).toBe(200);
  });
});
