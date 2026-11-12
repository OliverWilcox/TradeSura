import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as detail } from "@/app/api/admin/v1/engineers/[engineerId]/route";
import { PUT as putAddresses } from "@/app/api/admin/v1/engineers/[engineerId]/addresses/route";
import { GET as packs } from "@/app/api/admin/v1/member-packs/route";
import { GET as activity } from "@/app/api/admin/v1/engineers/[engineerId]/activity/route";
import { GET as settings, PATCH as patchSettings } from "@/app/api/settings/route";
import { PUT as putOwnAddresses } from "@/app/api/settings/addresses/route";
import { saveAddresses } from "@/lib/addresses";
import { applyAddressCopy, planAddressCopy } from "@/lib/admin/address-copy";
import { deleteOwnerAccount } from "@/lib/delete-account";
import { call, resetDb, SUPER_ADMIN, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

// The client's revised engineer record (31 Oct): three addresses, contact and
// source, Founding and activity, and the Gas Safe card.

const OFFICE = "Gateway Tower 32 Western Gateway, London, E16 1YL";
vi.mock("@/lib/admin/companies", async (original) => ({
  ...(await original<typeof import("@/lib/admin/companies")>()),
  companyProfile: async (n: string) => (n === "12345678" ? { number: n, name: "302 MD LTD", type: "ltd", status: "active", registeredOffice: OFFICE } : null),
}));
// The engineer's own settings routes: signed in as whoever the test says.
const session = vi.hoisted(() => ({ engineerId: null as string | null }));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), getEngineerId: async () => session.engineerId }));

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

beforeEach(async () => {
  await resetDb();
  session.engineerId = null;
});

/** 302 MD LTD as it signed up: its registered office given as its address, town empty. */
const md302 = (data: Parameters<typeof makeEngineer>[0] = {}) =>
  makeEngineer({
    tradingName: "302 MD LTD",
    legalName: "302 MD LTD",
    businessType: "ltd",
    companyNumber: "12345678",
    postcode: "E16 1YL",
    packAddress: "Gateway Tower\n32 Western Gateway\nLondon\nE16 1YL",
    packRequestedAt: daysAgo(3),
    serviceArea: "Holmfirth, Huddersfield, HD9",
    town: null,
    gasSafeVerifiedAt: daysAgo(2),
    gasSafeRegisterCheckedAt: daysAgo(2),
    ...data,
  });

const HOLMFIRTH = { lines: ["Unit 4, Holmfirth Mill", "Huddersfield Road"], town: "Holmfirth", postcode: "hd9 2tt" };

describe("ER.1: three addresses", () => {
  it("fixes 302 MD LTD: its registered office stops being its trading address, and its town is set", async () => {
    const e = await md302();
    const before = (await call(detail, { params: { engineerId: e.id } })).body.addresses;
    expect(before).toMatchObject({
      trading: { lines: ["Gateway Tower", "32 Western Gateway"], town: "London", postcode: "E16 1YL", source: null },
      correspondence: { sameAsTrading: true },
      registeredOffice: OFFICE,
      tradingIsRegisteredOffice: true,
    });

    const res = await call(putAddresses, { method: "PUT", params: { engineerId: e.id }, body: { trading: HOLMFIRTH, correspondence: "same", reason: "Rang Matt for the unit address" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ town: "Holmfirth", townBefore: null, correspondenceSameAsTrading: true });

    const saved = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(saved).toMatchObject({ town: "Holmfirth", townSlug: "holmfirth", postcode: "HD9 2TT", packAddress: "Unit 4, Holmfirth Mill\nHuddersfield Road\nHolmfirth\nHD9 2TT" });
    expect(await prisma.townPage.findUnique({ where: { slug: "holmfirth" } })).toMatchObject({ name: "Holmfirth" });
    expect(await prisma.event.findFirst({ where: { name: "engineer_addresses_changed" } })).toMatchObject({
      actorType: "ADMIN",
      meta: expect.objectContaining({ engineerId: e.id, townBefore: null, town: "Holmfirth", reason: "Rang Matt for the unit address" }),
    });

    const after = (await call(detail, { params: { engineerId: e.id } })).body;
    expect(after.town).toBe("Holmfirth");
    expect(after.addresses).toMatchObject({ trading: { town: "Holmfirth", source: "admin", updatedBy: SUPER_ADMIN.name }, tradingIsRegisteredOffice: false, correspondence: { sameAsTrading: true } });
    const pack = (await call(packs)).body.items.find((i: { id: string }) => i.id === e.id);
    expect(pack.addressCheck).toBe("ok");
  });

  it("needs engineers:edit, and staff have no addresses of their own", async () => {
    const e = await md302();
    const staff = await makeEngineer({ ownerId: e.id });
    const body = { trading: HOLMFIRTH, correspondence: "same" };
    expect((await call(putAddresses, { method: "PUT", as: withPermissions("engineers:read", "engineers:status"), params: { engineerId: e.id }, body })).status).toBe(403);
    expect((await call(putAddresses, { method: "PUT", params: { engineerId: staff.id }, body })).status).toBe(409);
    expect((await call(putAddresses, { method: "PUT", params: { engineerId: e.id }, body: { trading: { ...HOLMFIRTH, postcode: "HD9" }, correspondence: "same" } })).status).toBe(400);
  });

  it("sends post elsewhere when asked, and keeps it there when only the trading address moves", async () => {
    const e = await md302();
    const poBox = { lines: ["PO Box 12"], town: "Huddersfield", postcode: "HD1 1AA" };
    const res = await call(putAddresses, { method: "PUT", params: { engineerId: e.id }, body: { trading: HOLMFIRTH, correspondence: poBox } });
    expect(res.body.correspondenceSameAsTrading).toBe(false);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).packAddress).toBe("PO Box 12\nHuddersfield\nHD1 1AA");

    await prisma.$transaction((tx) => saveAddresses(tx, e.id, { trading: { lines: ["2 Market Walk"], town: "Holmfirth", postcode: "HD9 7DA" } }, { source: "engineer" }));
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).packAddress).toBe("PO Box 12\nHuddersfield\nHD1 1AA");

    await call(putAddresses, { method: "PUT", params: { engineerId: e.id }, body: { trading: HOLMFIRTH, correspondence: "same" } });
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).packAddress).toBe("Unit 4, Holmfirth Mill\nHuddersfield Road\nHolmfirth\nHD9 2TT");
  });

  it("lets the engineer change their own, and shows them in their settings", async () => {
    const e = await md302();
    session.engineerId = e.id;
    const res = await call(putOwnAddresses, { method: "PUT", token: null, body: { trading: HOLMFIRTH, correspondence: "same" } });
    expect(res.status).toBe(200);
    expect((await prisma.engineerTradingAddress.findUniqueOrThrow({ where: { engineerId: e.id } })).source).toBe("engineer");
    const mine = (await call(settings, { token: null })).body;
    expect(mine.addresses).toMatchObject({
      trading: { lines: HOLMFIRTH.lines, town: "Holmfirth", postcode: "HD9 2TT" },
      correspondence: "Unit 4, Holmfirth Mill\nHuddersfield Road\nHolmfirth\nHD9 2TT",
      correspondenceSameAsTrading: true,
    });
    expect((await call(putOwnAddresses, { method: "PUT", token: null, body: { trading: { ...HOLMFIRTH, town: "" }, correspondence: "same" } })).body).toMatchObject({ field: "trading", error: "Enter the town." });
  });

  it("copies sign-up addresses, but not a registered office or a town an admin must decide", async () => {
    const office = await md302();
    const soleTrader = await makeEngineer({ packAddress: "1 High Street\nHolmfirth\nHD9 1AA", town: null });
    const elsewhere = await makeEngineer({ packAddress: "1 High Street\nHolmfirth\nHD9 1AA", town: "Leeds", townSlug: "leeds" });
    const none = await makeEngineer({ packAddress: null });
    const plan = await planAddressCopy();
    const by = Object.fromEntries(plan.map((s) => [s.id, s]));
    expect(by[office.id]).toMatchObject({ action: "skip", why: expect.stringContaining("registered office") });
    expect(by[soleTrader.id]).toMatchObject({ action: "copy", fillsTown: true, address: { lines: ["1 High Street"], town: "Holmfirth", postcode: "HD9 1AA" } });
    expect(by[elsewhere.id]).toMatchObject({ action: "skip", why: expect.stringContaining("an admin decides") });
    expect(by[none.id]).toMatchObject({ action: "skip", why: "no address given" });
    // A dry run changes nothing.
    expect(await prisma.engineerTradingAddress.count()).toBe(0);

    expect(await applyAddressCopy(plan)).toEqual({ copied: 1 });
    expect(await prisma.engineerTradingAddress.findUniqueOrThrow({ where: { engineerId: soleTrader.id } })).toMatchObject({ source: "signup", town: "Holmfirth" });
    expect(await prisma.engineer.findUniqueOrThrow({ where: { id: soleTrader.id } })).toMatchObject({ town: "Holmfirth", townSlug: "holmfirth" });
    expect((await planAddressCopy()).some((s) => s.id === soleTrader.id)).toBe(false);
  });

  it("deletes the trading address with the account", async () => {
    const e = await md302();
    await call(putAddresses, { method: "PUT", params: { engineerId: e.id }, body: { trading: HOLMFIRTH, correspondence: "same" } });
    expect(await deleteOwnerAccount(e.id)).toEqual({ ok: true });
    expect(await prisma.engineerTradingAddress.count()).toBe(0);
  });
});

describe("ER.2: contact and source", () => {
  it("shows when the mobile was checked, both consents, the source and the letter", async () => {
    const e = await makeEngineer({
      phoneVerifiedAt: daysAgo(5),
      setupTextConsentAt: daysAgo(5),
      marketingConsent: false,
      attribution: { heardVia: "letter", referralCode: "smith-heating" },
    });
    await prisma.claimCode.create({ data: { code: "TS-48217", firstName: "Dave", businessName: "Smith Heating", letterBatch: "HD-OCT-1", variantCell: "C", redeemedByEngineerId: e.id, redeemedAt: daysAgo(5) } });
    const r = (await call(detail, { params: { engineerId: e.id } })).body;
    expect(r.contact).toMatchObject({ phone: expect.stringMatching(/•/), phoneVerifiedAt: expect.any(String), setupTextConsentAt: expect.any(String), marketingConsent: false });
    expect(r.channel).toBe("letter");
    expect(r.referralCodeGiven).toBe("smith-heating");
    expect(r.letter).toMatchObject({ code: "TS-48217", batch: "HD-OCT-1", variant: "C" });
  });

  it("says when setup texts haven't been agreed to", async () => {
    const e = await makeEngineer();
    expect((await call(detail, { params: { engineerId: e.id } })).body.contact.setupTextConsentAt).toBeNull();
  });

  it("puts a change of mind about setup texts on the Activity tab, once per change", async () => {
    const e = await makeEngineer();
    session.engineerId = e.id;
    for (const setupTextConsent of [true, true, false]) {
      expect((await call(patchSettings, { method: "PATCH", token: null, body: { setupTextConsent } })).status).toBe(200);
    }
    expect((await call(patchSettings, { method: "PATCH", token: null, body: { tradingName: "Hartley Heating", setupTextConsent: true } })).status).toBe(200);
    const rows = (await call(activity, { params: { engineerId: e.id } })).body.items as { name: string; actor: { name: string | null } }[];
    expect(rows.filter((r) => r.name.startsWith("setup_texts")).map((r) => r.name)).toEqual(["setup_texts_opted_in", "setup_texts_opted_out", "setup_texts_opted_in"]);
    expect(rows.find((r) => r.name === "setup_texts_opted_in")!.actor.name).toMatch(/\(engineer\)$/);
  });
});

describe("ER.3: Founding, the follow-up ladder and the cancel rate", () => {
  it("reads Founding from the app's own record, and works the rest out from the same offers and plans as everything else", async () => {
    await prisma.townPage.create({ data: { slug: "holmfirth", name: "Holmfirth" } });
    const inHolmfirth = { town: "Holmfirth", townSlug: "holmfirth", packRequestedAt: daysAgo(1), gasSafeRegisterCheckedAt: daysAgo(100) };
    const first = await makeEngineer({ ...inHolmfirth, gasSafeVerifiedAt: daysAgo(100) });
    const lapsed = await makeEngineer({ ...inHolmfirth, gasSafeVerifiedAt: daysAgo(90) });
    const newest = await makeEngineer({ ...inHolmfirth, gasSafeVerifiedAt: daysAgo(40) });
    await prisma.topSpot.create({ data: { townSlug: "holmfirth", engineerId: first.id, heldFrom: daysAgo(95) } });
    await prisma.topSpot.create({ data: { townSlug: "holmfirth", engineerId: lapsed.id, heldFrom: daysAgo(90), releasedAt: daysAgo(30), releaseReason: "no_customer" } });
    const spot = await prisma.topSpot.create({ data: { townSlug: "holmfirth", engineerId: newest.id, heldFrom: daysAgo(35) } });
    await prisma.event.create({ data: { name: "top_spot_reminder", actorType: "SYSTEM", meta: { spotId: spot.id, engineerId: newest.id, days: 30 } } });
    // The lapsed engineer claimed their letter in time: still a Founding Member.
    await prisma.claimCode.create({ data: { code: "TS-11111", firstName: "Dave", businessName: "Lapsed", letterBatch: "B1", variantCell: "A", redeemedByEngineerId: lapsed.id, redeemedAt: daysAgo(91), claimedAt: daysAgo(91), createdAt: daysAgo(92) } });

    // The first engineer: an offer by text three days ago (delivered), an
    // unopened WhatsApp one yesterday (not confirmed), and a cancellation.
    const keeps = await makePlan(first.id, (await makeCustomer(first.id)).id);
    const cancelled = await makePlan(first.id, (await makeCustomer(first.id)).id, { status: "CANCELLED", activatedAt: daysAgo(60), cancelledAt: daysAgo(10) });
    const pending = await makePlan(first.id, (await makeCustomer(first.id)).id, { status: "PENDING", activatedAt: null });
    await prisma.event.createMany({
      data: [
        { name: "offer_sent", actorType: "ENGINEER", actorId: first.id, ts: daysAgo(3), meta: { planId: keeps.id, channel: "sms" } },
        { name: "offer_sent", actorType: "ENGINEER", actorId: first.id, ts: daysAgo(1), meta: { planId: pending.id, channel: "whatsapp" } },
        { name: "offer_sent", actorType: "ENGINEER", actorId: first.id, ts: daysAgo(70), meta: { planId: cancelled.id, channel: "sms" } },
      ],
    });

    const [a, b, c] = await Promise.all([first, lapsed, newest].map(async (e) => (await call(detail, { params: { engineerId: e.id } })).body));
    expect(a.founding).toMatchObject({ member: true, label: "Founding · top spot", town: "Holmfirth", spot: { state: "holding", position: 1, kept: true }, rules: { spotsPerTown: 3, spotDays: 60, reminderDays: [30, 14, 7, 2] } });
    expect(b.founding).toMatchObject({ member: true, label: "Founding", spot: { state: "released", reason: "no_customer" } });
    expect(c.founding).toMatchObject({ label: "Founding · top spot", spot: { state: "holding", position: 2, daysLeft: 25, kept: false, remindersSent: [30] } });

    expect(a.offersLast7Days).toBe(1);
    expect(a.chase).toMatchObject({ countingFrom: "last_offer", days: 3, step: { step: 1, label: "Push" } });
    expect(c.chase).toMatchObject({ countingFrom: "live", lastDeliveredOfferAt: null, days: 40, step: { step: 4, label: "Call list" } });
    // 50% is the average here, and 2 customers is under the 10 the flag needs.
    expect(a.cancelRate).toMatchObject({ cancelled: 1, live: 1, percent: 50, windowDays: 90, averagePercent: 50, flagged: false });

    const versions = Object.fromEntries((await call(packs)).body.items.map((i: { id: string; version: unknown }) => [i.id, i.version]));
    expect(versions[first.id]).toBe("Founding · top spot");
    expect(versions[lapsed.id]).toBe("Founding");
  });

  it("flags a cancel rate only past the 4 Nov rule: 10 customers, 2 cancellations, double the average", async () => {
    const steady = await makeEngineer({ gasSafeVerifiedAt: daysAgo(200) });
    for (let i = 0; i < 18; i++) await makePlan(steady.id, (await makeCustomer(steady.id)).id);
    await makePlan(steady.id, (await makeCustomer(steady.id)).id, { status: "CANCELLED", activatedAt: daysAgo(60), cancelledAt: daysAgo(5) });
    const leaky = await makeEngineer({ gasSafeVerifiedAt: daysAgo(200) });
    for (let i = 0; i < 7; i++) await makePlan(leaky.id, (await makeCustomer(leaky.id)).id);
    for (let i = 0; i < 3; i++) await makePlan(leaky.id, (await makeCustomer(leaky.id)).id, { status: "CANCELLED", activatedAt: daysAgo(60), cancelledAt: daysAgo(5) });
    const rate = async (id: string) => (await call(detail, { params: { engineerId: id } })).body.cancelRate;
    // 4 of 29 overall (13.8%); leaky is 3 of 10 (30%), more than double.
    expect(await rate(leaky.id)).toMatchObject({ percent: 30, averagePercent: 13.8, flagged: true });
    expect(await rate(steady.id)).toMatchObject({ percent: 5.3, flagged: false });
  });

  it("has no Founding without a spot or a letter, and no follow-up while paused", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: daysAgo(30), pausedAt: daysAgo(1), town: null });
    const r = (await call(detail, { params: { engineerId: e.id } })).body;
    expect(r.founding).toMatchObject({ member: false, label: "Standard", spot: null });
    expect(r.chase).toBeNull();
  });
});

describe("ER.4: the Gas Safe card", () => {
  it("shows both numbers, the card, qualifications and the next register check", async () => {
    const e = await makeEngineer({
      gasSafeNo: "1234567",
      gasSafeRegistrationNo: "584123",
      gasSafeCategories: "Domestic natural gas",
      gasSafeCardUrl: "https://x.public.blob.vercel-storage.com/card.png",
      gasSafeCardExpiresOn: new Date("2027-01-31"),
      gasSafeVerifiedAt: new Date("2026-06-01T10:00:00Z"),
      gasSafeRegisterCheckedAt: new Date("2026-06-01T15:00:00Z"),
      qualificationConfirmations: { GAS_FIRE_SERVICE: "2026-06-02" },
    });
    const r = (await call(detail, { params: { engineerId: e.id } })).body;
    expect(r.gasSafe).toEqual({
      licenceNo: "1234567",
      registrationNo: "584123",
      categories: "Domestic natural gas",
      cardOnFile: true,
      cardExpiresOn: "2027-01-31",
      qualifications: [{ code: "GAS_FIRE_SERVICE", title: expect.any(String), confirmedAt: "2026-06-02" }],
      nextRegisterCheck: "2027-02-14",
    });
  });
});
