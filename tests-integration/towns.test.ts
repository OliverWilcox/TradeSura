import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { GET as list } from "@/app/api/admin/v1/towns/route";
import { GET as detail } from "@/app/api/admin/v1/towns/[slug]/route";
import { POST as give } from "@/app/api/admin/v1/towns/[slug]/spots/route";
import { POST as release } from "@/app/api/admin/v1/towns/[slug]/spots/[spotId]/release/route";
import { GET as leadWindow, PUT as setLeadWindow } from "@/app/api/admin/v1/settings/town-leads/route";
import { createTownLead } from "@/lib/town-leads";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

// Founding Members and town pages (Matt, 4 Nov, section 3.2): the admin's
// view per town (spots taken, live, released), the manual override with a
// reason, and the first-pick window for town page requests. The rules are
// the app's (lib/founding.ts); these check the admin reads and changes them
// the way the app does.

beforeEach(resetDb);

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
let codes = 0;

/** An engineer in a town: listed on its page, a Founding Member, complete — as each test needs. */
async function engineerIn(
  townSlug: string,
  { founding = false, listed = true, completedDaysAgo = null as number | null, ...data }: { founding?: boolean; listed?: boolean; completedDaysAgo?: number | null } & Partial<Prisma.EngineerUncheckedCreateInput> = {},
) {
  const e = await makeEngineer({
    town: townSlug === "holmfirth" ? "Holmfirth" : "Marsden",
    townSlug,
    gasSafeVerifiedAt: daysAgo(100),
    profilePublishedAt: listed ? daysAgo(90) : null,
    stripeChargesEnabled: true,
    accountCompletedAt: completedDaysAgo === null ? null : daysAgo(completedDaysAgo),
    ...data,
  });
  if (listed) await prisma.planTier.create({ data: { engineerId: e.id, name: "Care", priceMonthlyPence: 1500, sortOrder: 1, status: "LIVE" } });
  if (founding) {
    codes += 1;
    // Claimed in time: the batch's window is 28 days from its codes being loaded.
    await prisma.claimCode.create({
      data: { code: `TS-${20000 + codes}`, firstName: "Dave", businessName: e.tradingName!, letterBatch: "B1", variantCell: "A", redeemedByEngineerId: e.id, redeemedAt: daysAgo(100), claimedAt: daysAgo(100), createdAt: daysAgo(101) },
    });
  }
  return e;
}

/**
 * Holmfirth: three spots held (kept, on the clock, and one whose holder isn't
 * on the page), one released, two Founding Members waiting, two engineers
 * without the badge, and a member of staff.
 */
async function holmfirth() {
  await prisma.townPage.create({ data: { slug: "holmfirth", name: "Holmfirth", publishedAt: daysAgo(80) } });
  await prisma.townPage.create({ data: { slug: "marsden", name: "Marsden" } });
  const a = await engineerIn("holmfirth", { founding: true, completedDaysAgo: 90, tradingName: "Ash Gas" });
  const b = await engineerIn("holmfirth", { founding: true, completedDaysAgo: 45, tradingName: "Birch Heating" });
  const c = await engineerIn("holmfirth", { founding: true, completedDaysAgo: 6, listed: false, tradingName: "Cedar Boilers" });
  const d = await engineerIn("holmfirth", { founding: true, completedDaysAgo: 20, tradingName: "Dale Gas" });
  const e = await engineerIn("holmfirth", { founding: true, completedDaysAgo: 10, tradingName: "Elm Heating" });
  const f = await engineerIn("holmfirth", { founding: true, completedDaysAgo: 100, tradingName: "Fern Gas" });
  const g = await engineerIn("holmfirth", { tradingName: "Glen Heating" });
  const h = await engineerIn("holmfirth", { tradingName: "Holly Gas" });
  await makeEngineer({ townSlug: "holmfirth", ownerId: g.id, tradingName: "Glen's apprentice" });

  const spot = (engineerId: string, heldDaysAgo: number, released?: { daysAgo: number; reason: string }) =>
    prisma.topSpot.create({
      data: { townSlug: "holmfirth", engineerId, heldFrom: daysAgo(heldDaysAgo), ...(released ? { releasedAt: daysAgo(released.daysAgo), releaseReason: released.reason } : {}) },
    });
  await spot(f.id, 100, { daysAgo: 40, reason: "no_customer" });
  const spotA = await spot(a.id, 80);
  const spotB = await spot(b.id, 40);
  const spotC = await spot(c.id, 5);
  await prisma.event.create({ data: { name: "top_spot_reminder", actorType: "SYSTEM", meta: { spotId: spotB.id, engineerId: b.id, days: 30 } } });

  // A signed a customer; Glen has two paying (one cancelling, which doesn't count); Holly has reviews.
  await makePlan(a.id, (await makeCustomer(a.id)).id);
  for (let i = 0; i < 2; i++) await makePlan(g.id, (await makeCustomer(g.id)).id);
  await makePlan(g.id, (await makeCustomer(g.id)).id, { cancelRequestedAt: daysAgo(1) });
  for (const stars of [5, 4]) {
    await prisma.rating.create({ data: { engineerId: h.id, requestToken: `rate-${stars}`, stars, ratedAt: daysAgo(stars) } });
  }
  return { a, b, c, d, e, f, g, h, spotA, spotB, spotC };
}

const at = (slug: string) => ({ params: { slug } });

describe("the towns list", () => {
  it("counts each town's spots taken, live and released, and the Founding Members waiting", async () => {
    await holmfirth();
    const res = await call(list);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { slug: "holmfirth", name: "Holmfirth", page: "public", spots: 3, taken: 3, live: 2, released: 1, nextInLine: 2, foundingMembers: 6, listed: 7 },
        { slug: "marsden", name: "Marsden", page: "not_public", spots: 3, taken: 0, live: 0, released: 0, nextInLine: 0, foundingMembers: 0, listed: 0 },
      ],
      page: 1,
      size: 25,
      total: 2,
    });
    expect((await call(list, { query: { q: "MARS" } })).body.items.map((t: { slug: string }) => t.slug)).toEqual(["marsden"]);
    expect((await call(list, { as: CHECKER })).status).toBe(403);
  });
});

describe("a town", () => {
  it("shows its spots in order, those released, who's next, and the town page's order", async () => {
    const t = await holmfirth();
    const res = await call(detail, at("holmfirth"));
    expect(res.status).toBe(200);
    const town = res.body;
    expect(town).toMatchObject({ slug: "holmfirth", name: "Holmfirth", page: "public", url: expect.stringMatching(/\/gas-engineers\/holmfirth$/), rules: { spotsPerTown: 3, spotDays: 60, reminderDays: [30, 14, 7, 2] }, leadWindowMinutes: 120 });
    expect(town.spots).toMatchObject([
      { position: 1, engineer: { id: t.a.id, name: "Ash Gas" }, customerSigned: true, live: true, given: null },
      { position: 2, engineer: { id: t.b.id }, customerSigned: false, daysLeft: 20, remindersSent: [30], live: true },
      // Holds a spot but isn't on the page: taken, not live.
      { position: 3, engineer: { id: t.c.id }, live: false },
    ]);
    expect(town.released).toMatchObject([{ engineer: { id: t.f.id }, reason: "no_customer", by: null, note: null }]);
    expect(town.nextInLine.map((e: { id: string }) => e.id)).toEqual([t.d.id, t.e.id]);
    // Top spots in the order they got them › paying customers › reviews (number, average, recency), then A–Z.
    expect(town.order.map((r: { name: string; group: string }) => `${r.name} (${r.group})`)).toEqual([
      "Ash Gas (top_spot)",
      "Birch Heating (top_spot)",
      "Glen Heating (most_active)",
      "Holly Gas (reviews)",
      "Dale Gas (reviews)",
      "Elm Heating (reviews)",
      "Fern Gas (reviews)",
    ]);
    expect(town.order[2]).toMatchObject({ position: 3, payingCustomers: 2 });
    expect(town.order[3]).toMatchObject({ reviews: { count: 2, average: 4.5, lastAt: expect.any(String) } });
    // Anyone trading here without a spot, the next in line first. Never staff.
    expect(town.eligible.map((e: { name: string }) => e.name)).toEqual(["Dale Gas", "Elm Heating", "Fern Gas", "Glen Heating", "Holly Gas"]);
    expect(town.eligible[0]).toMatchObject({ owner: expect.stringMatching(/^Dave Smith\d+$/), founding: true, nextInLine: true });

    expect((await call(detail, at("nowhere"))).status).toBe(404);
  });
});

describe("the manual override", () => {
  it("releases a spot to the next in line, with the admin's reason recorded", async () => {
    const t = await holmfirth();
    const res = await call(release, { params: { slug: "holmfirth", spotId: t.spotB.id }, body: { reason: "Off sick for three months", to: null } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: t.b.id, givenTo: { id: t.d.id, name: "Dale Gas" } });

    expect(await prisma.topSpot.findUnique({ where: { id: t.spotB.id } })).toMatchObject({ releasedAt: expect.any(Date), releaseReason: "admin" });
    expect(await prisma.topSpot.findFirst({ where: { engineerId: t.d.id, releasedAt: null } })).toMatchObject({ townSlug: "holmfirth" });
    const released = await prisma.event.findFirstOrThrow({ where: { name: "top_spot_released", actorType: "ADMIN" } });
    expect(released.meta).toMatchObject({ spotId: t.spotB.id, engineerId: t.b.id, reason: "admin", note: "Off sick for three months", adminName: "Test Super" });
    // The next in line got it the way the app hands spots out.
    expect(await prisma.event.count({ where: { name: "top_spot_awarded", actorType: "SYSTEM", meta: { path: ["engineerId"], equals: t.d.id } } })).toBe(1);

    const town = (await call(detail, at("holmfirth"))).body;
    expect(town.released[0]).toMatchObject({ engineer: { id: t.b.id }, reason: "admin", by: "Test Super", note: "Off sick for three months" });
    expect(town.spots.map((s: { engineer: { id: string } }) => s.engineer.id)).toEqual([t.a.id, t.c.id, t.d.id]);
    // Released by an admin, they aren't next in line for it again.
    expect(town.nextInLine.map((e: { id: string }) => e.id)).toEqual([t.e.id]);

    expect((await call(release, { params: { slug: "holmfirth", spotId: t.spotB.id }, body: { reason: "Again, by mistake", to: null } })).status).toBe(409);
  });

  it("can pass a released spot to someone in particular, and gives a free one out of turn", async () => {
    const t = await holmfirth();
    const res = await call(release, { params: { slug: "holmfirth", spotId: t.spotC.id }, body: { reason: "Moving to Halifax next month", to: t.h.id } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ released: t.c.id, givenTo: { id: t.h.id, name: "Holly Gas" } });
    const given = await prisma.event.findFirstOrThrow({ where: { name: "top_spot_awarded", actorType: "ADMIN" } });
    expect(given.meta).toMatchObject({ engineerId: t.h.id, townSlug: "holmfirth", note: "Moving to Halifax next month" });
    const spot = (await call(detail, at("holmfirth"))).body.spots.find((s: { engineer: { id: string } }) => s.engineer.id === t.h.id);
    expect(spot).toMatchObject({ position: 3, daysLeft: 60, given: { by: "Test Super", reason: "Moving to Halifax next month" } });

    // Full: a spot has to be released first.
    expect((await call(give, { params: { slug: "holmfirth" }, body: { engineerId: t.g.id, reason: "Busiest engineer in town" } })).status).toBe(409);

    // Marsden has room: a spot for an engineer there, not for one from elsewhere.
    const m = await engineerIn("marsden");
    expect((await call(give, { params: { slug: "marsden" }, body: { engineerId: t.g.id, reason: "Busiest engineer in town" } })).status).toBe(400);
    const ok = await call(give, { params: { slug: "marsden" }, body: { engineerId: m.id, reason: "First engineer in Marsden" } });
    expect(ok.status).toBe(200);
    expect(ok.body.givenTo).toEqual({ id: m.id, name: m.tradingName });
    expect((await call(list, { query: { q: "marsden" } })).body.items[0]).toMatchObject({ taken: 1, live: 1 });
  });

  it("refuses what would break the rules", async () => {
    const t = await holmfirth();
    // Back to the engineer releasing it, someone already holding one, staff, or no reason.
    expect((await call(release, { params: { slug: "holmfirth", spotId: t.spotA.id }, body: { reason: "Restart the clock", to: t.a.id } })).status).toBe(400);
    expect((await call(release, { params: { slug: "holmfirth", spotId: t.spotA.id }, body: { reason: "Give it to Birch", to: t.b.id } })).status).toBe(409);
    expect((await call(release, { params: { slug: "holmfirth", spotId: t.spotA.id }, body: { to: null } })).status).toBe(400);
    expect((await call(release, { params: { slug: "marsden", spotId: t.spotA.id }, body: { reason: "Wrong town", to: null } })).status).toBe(404);
    // Nothing changed.
    expect(await prisma.topSpot.count({ where: { townSlug: "holmfirth", releasedAt: null } })).toBe(3);

    const reader = withPermissions("towns:read");
    expect((await call(release, { as: reader, params: { slug: "holmfirth", spotId: t.spotA.id }, body: { reason: "Not allowed to", to: null } })).status).toBe(403);
    expect((await call(give, { as: reader, params: { slug: "marsden" }, body: { engineerId: t.g.id, reason: "Not allowed to" } })).status).toBe(403);
  });
});

describe("first pick of town page requests", () => {
  it("is 2 hours until an admin changes it, and new requests use the new window", async () => {
    expect((await call(leadWindow)).body).toEqual({ minutes: 120, defaultMinutes: 120, maxMinutes: 1440 });
    const res = await call(setLeadWindow, { method: "PUT", body: { minutes: 45 } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ minutes: 45, before: 120 });
    expect((await call(leadWindow)).body.minutes).toBe(45);
    expect((await prisma.event.findFirstOrThrow({ where: { name: "town_lead_window_changed" } })).meta).toMatchObject({ before: 120, after: 45, adminName: "Test Super" });

    await prisma.townPage.create({ data: { slug: "holmfirth", name: "Holmfirth" } });
    await engineerIn("holmfirth", { founding: true, completedDaysAgo: 10 });
    const now = new Date();
    const lead = await createTownLead({ townSlug: "holmfirth", townName: "Holmfirth", name: "Pat Hughes", phone: "+447700900999", email: null, postcode: "HD9 2AA", message: "Boiler service", emergency: null }, now);
    expect(lead.foundingUntil.getTime() - now.getTime()).toBe(45 * 60_000);

    for (const minutes of [-1, 1441, 1.5, "60"]) expect((await call(setLeadWindow, { method: "PUT", body: { minutes } })).status).toBe(400);
    expect((await call(setLeadWindow, { method: "PUT", as: withPermissions("towns:read"), body: { minutes: 60 } })).status).toBe(403);
  });
});
