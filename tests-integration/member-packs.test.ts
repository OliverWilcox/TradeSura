import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/member-packs/route";
import { POST as posted } from "@/app/api/admin/v1/member-packs/[engineerId]/posted/route";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeEngineer } from "./factories";

beforeEach(resetDb);

const requested = { packAddress: "1 High Street\nLeeds\nLS1 4AB", packRequestedAt: new Date("2026-10-01") };
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe("member packs", () => {
  it("are ready to post only once the badge is live, and held while paused or banned", async () => {
    const ready = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date("2026-10-02") });
    const unverified = await makeEngineer(requested);
    const paused = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date(), pausedAt: new Date() });
    await makeEngineer(); // never asked for one

    const toPost = await call(list);
    expect(ids(toPost)).toEqual([ready.id]);
    expect(toPost.body.items[0]).toMatchObject({ address: "1 High Street\nLeeds\nLS1 4AB", heldBecause: null });
    expect(toPost.body.counts).toEqual({ to_post: 1, held: 2, posted: 0 });

    const held = await call(list, { query: { tab: "held" } });
    expect(Object.fromEntries(held.body.items.map((i: { id: string; heldBecause: string }) => [i.id, i.heldBecause]))).toEqual({
      [unverified.id]: "not_verified",
      [paused.id]: "paused",
    });
  });

  it("can be marked posted once, and it's recorded against the admin", async () => {
    const e = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date() });
    const first = await call(posted, { params: { engineerId: e.id }, method: "POST" });
    expect(first.status).toBe(200);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).packShippedAt).toBeInstanceOf(Date);
    const event = await prisma.event.findFirstOrThrow({ where: { name: "member_pack_shipped" } });
    expect(event).toMatchObject({ actorType: "ADMIN", actorId: "adm_test_super" });

    const again = await call(posted, { params: { engineerId: e.id }, method: "POST" });
    expect(again.status).toBe(409);
    expect(await prisma.event.count({ where: { name: "member_pack_shipped" } })).toBe(1);
  });

  it("can't be posted to an engineer who isn't verified", async () => {
    const e = await makeEngineer(requested);
    const res = await call(posted, { params: { engineerId: e.id }, method: "POST" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/verified/);
  });

  it("need their own permissions", async () => {
    const e = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date() });
    expect((await call(list, { as: CHECKER })).status).toBe(403);
    expect((await call(posted, { params: { engineerId: e.id }, method: "POST", as: withPermissions("member_packs:read") })).status).toBe(403);
  });
});
