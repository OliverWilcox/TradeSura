import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/member-packs/route";
import { POST as posted } from "@/app/api/admin/v1/member-packs/[engineerId]/posted/route";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeEngineer } from "./factories";

// Posting a pack tells the engineer; nothing is really sent here.
const sent = vi.hoisted(() => ({ push: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotification: sent.push }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email, emailConfigured: () => true }));

beforeEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

const requested = { packAddress: "1 High Street\nLeeds\nLS1 4AB", packRequestedAt: new Date("2026-10-01") };
/** Live, with the register check passed: a pack can go (Matt, 4 Nov). */
const checked = { gasSafeVerifiedAt: new Date("2026-10-02"), gasSafeRegisterCheckedAt: new Date("2026-10-02") };
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe("member packs", () => {
  it("are ready to post only once the register check has passed, and held while paused or banned", async () => {
    const ready = await makeEngineer({ ...requested, ...checked });
    const unverified = await makeEngineer(requested);
    const registerDue = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date() });
    const paused = await makeEngineer({ ...requested, ...checked, pausedAt: new Date() });
    await makeEngineer(); // never asked for one

    const toPost = await call(list);
    expect(ids(toPost)).toEqual([ready.id]);
    expect(toPost.body.items[0]).toMatchObject({ address: "1 High Street\nLeeds\nLS1 4AB", heldBecause: null });
    expect(toPost.body.counts).toEqual({ to_post: 1, held: 3, posted: 0 });

    const held = await call(list, { query: { tab: "held" } });
    expect(Object.fromEntries(held.body.items.map((i: { id: string; heldBecause: string }) => [i.id, i.heldBecause]))).toEqual({
      [unverified.id]: "not_verified",
      [registerDue.id]: "register_check_due",
      [paused.id]: "paused",
    });
  });

  it("can be marked posted once, and it's recorded against the admin", async () => {
    const e = await makeEngineer({ ...requested, ...checked });
    const first = await call(posted, { params: { engineerId: e.id }, method: "POST" });
    expect(first.status).toBe(200);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).packShippedAt).toBeInstanceOf(Date);
    const event = await prisma.event.findFirstOrThrow({ where: { name: "member_pack_shipped" } });
    expect(event).toMatchObject({ actorType: "ADMIN", actorId: "adm_test_super" });

    const again = await call(posted, { params: { engineerId: e.id }, method: "POST" });
    expect(again.status).toBe(409);
    expect(await prisma.event.count({ where: { name: "member_pack_shipped" } })).toBe(1);
  });

  it("can't be posted before the register check has passed", async () => {
    const e = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date() });
    const res = await call(posted, { params: { engineerId: e.id }, method: "POST" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/register check/);
  });

  it("can't be posted to an address that won't print (QA-21)", async () => {
    const e = await makeEngineer({ ...requested, ...checked, packAddress: null });
    const res = await call(posted, { params: { engineerId: e.id }, method: "POST" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/postal address/);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).packShippedAt).toBeNull();
    expect(sent.email).not.toHaveBeenCalled();
  });

  it("need their own permissions", async () => {
    const e = await makeEngineer({ ...requested, ...checked });
    expect((await call(list, { as: CHECKER })).status).toBe(403);
    expect((await call(posted, { params: { engineerId: e.id }, method: "POST", as: withPermissions("member_packs:read") })).status).toBe(403);
  });
});

describe("the print file's fields (6.2, 6.3)", () => {
  it("carry what Ali's merge file needs: version, first name, town, page slug, first plan, referral code and its link", async () => {
    const e = await makeEngineer({ ...requested, ...checked, firstName: "Matt", lastName: "Wood", town: "Huddersfield", slug: "302-md" });
    await prisma.planTier.createMany({
      data: [
        { engineerId: e.id, name: "Boiler Care Plus", priceMonthlyPence: 1999, sortOrder: 2, status: "LIVE" },
        { engineerId: e.id, name: "Boiler Care", priceMonthlyPence: 1250, sortOrder: 1, status: "LIVE" },
        { engineerId: e.id, name: "Draft plan", priceMonthlyPence: 500, sortOrder: 0, status: "DRAFT" },
      ],
    });
    const [row] = (await call(list)).body.items;
    expect(row).toMatchObject({
      id: e.id,
      firstName: "Matt",
      town: "Huddersfield",
      slug: "302-md",
      version: "Standard",
      // 80% of £12.50 is £10.00 a month: £120 a year, × 20 and × 50 customers.
      firstPlan: { name: "Boiler Care", pricePence: 1250, yearly20Pence: 240_000, yearly50Pence: 600_000 },
      livePage: "http://localhost:3000/302-md",
      referralCode: expect.stringMatching(/^WOOD\d{2}$/),
      addressCheck: "ok",
    });
    expect(row.qrLink).toBe(`http://localhost:3000/r/${row.referralCode}`);
    // Made once and kept.
    expect((await call(list)).body.items[0].referralCode).toBe(row.referralCode);
  });

  it("block a pack with no postal address (6.1)", async () => {
    await makeEngineer({ packRequestedAt: new Date(), packAddress: null, ...checked });
    expect((await call(list)).body.items[0].addressCheck).toBe("missing");
  });
});

describe("posting a pack (6.4)", () => {
  it("tells the engineer it's on its way", async () => {
    const e = await makeEngineer({ ...requested, ...checked, email: "matt@example.test", firstName: "Matt" });
    expect((await call(posted, { params: { engineerId: e.id }, body: {} })).status).toBe(200);
    expect(sent.push).toHaveBeenCalledWith(e.id, "Your member pack is on its way", expect.any(String), expect.anything());
    expect(sent.email).toHaveBeenCalledWith(expect.objectContaining({ to: "matt@example.test", subject: "Your member pack is on its way" }));
  });
});
