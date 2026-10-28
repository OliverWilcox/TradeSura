import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { adminRoute } from "@/lib/admin-api/route";
import { bounded, shared } from "@/lib/admin-api/db";
import { exportEngineers } from "@/lib/admin/engineers";
import { withTimeout } from "@/lib/admin/verifications";
import { GET as engineers } from "@/app/api/admin/v1/engineers/route";
import { GET as engineer } from "@/app/api/admin/v1/engineers/[engineerId]/route";
import { GET as engineerExport } from "@/app/api/admin/v1/engineers/export/route";
import { POST as engineerContact } from "@/app/api/admin/v1/engineers/[engineerId]/contact/route";
import { POST as engineerNote } from "@/app/api/admin/v1/engineers/[engineerId]/notes/route";
import { DELETE as deleteEngineerNote } from "@/app/api/admin/v1/engineers/[engineerId]/notes/[noteId]/route";
import { GET as customers } from "@/app/api/admin/v1/customers/route";
import { GET as customerExport } from "@/app/api/admin/v1/customers/export/route";
import { POST as customerContact } from "@/app/api/admin/v1/customers/[customerId]/contact/route";
import { GET as verifications } from "@/app/api/admin/v1/verifications/route";
import { GET as verification } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { POST as claim } from "@/app/api/admin/v1/verifications/[engineerId]/claim/route";
import { POST as decide } from "@/app/api/admin/v1/verifications/[engineerId]/decision/route";
import { GET as signupsRoute } from "@/app/api/admin/v1/dashboard/signups/route";
import { GET as packs } from "@/app/api/admin/v1/member-packs/route";
import { POST as packsPosted } from "@/app/api/admin/v1/member-packs/posted/route";
import { call, CHECKER, resetDb, SUPER_ADMIN, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

// The fixes from the production-readiness QA of 25 October 2026, one block
// per finding (M1 = medium 1, and so on).

const sent = vi.hoisted(() => ({ push: vi.fn(), sms: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotification: sent.push }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: sent.sms }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
const other = { ...CHECKER, id: "adm_test_other", name: "Other Checker" };

describe("H1 and H2: slow queries", () => {
  it("are stopped by Postgres, and answered as a 503 rather than left running", async () => {
    await expect(bounded(prisma.$queryRaw`SELECT pg_sleep(2)`, 100)).rejects.toThrow();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const slow = adminRoute(null, async () => bounded(prisma.$queryRaw`SELECT pg_sleep(2)`, 100));
    const res = await call(slow);
    log.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("TIMEOUT");
  });

  it("asked for at the same time share one run", async () => {
    let runs = 0;
    const work = () => new Promise<number>((resolve) => setTimeout(() => resolve(++runs), 20));
    const answers = await Promise.all(Array.from({ length: 10 }, () => shared("same", work)));
    expect(answers).toEqual(Array(10).fill(1));
    expect(await shared("same", work)).toBe(2); // nothing kept once answered
  });
});

describe("M1: claiming an application", () => {
  it("goes to one admin when two claim it at the same moment, and is recorded once", async () => {
    const e = await makeEngineer();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => call(claim, { as: i % 2 ? other : CHECKER, params: { engineerId: e.id }, method: "POST" })),
    );
    const winners = new Set(results.filter((r) => r.body.claimed).map((r) => r.body.lock.holderId));
    expect(winners.size).toBe(1);
    const winner = [...winners][0];
    for (const r of results) expect(r.body.lock.holderId).toBe(winner);
    expect(await prisma.event.count({ where: { name: "verification_claimed" } })).toBe(1);
  });
});

describe("M2: a rejection's note", () => {
  it("travels apart from the reason, so each can be 500 characters", async () => {
    const e = await makeEngineer();
    const note = "n".repeat(495);
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Other", note } });
    expect(res.status).toBe(200);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRejectReason).toBe(`Other: ${note}`);
  });

  it("names the field that's wrong when it's too long", async () => {
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Other", note: "n".repeat(501) } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ message: "Keep the note under 500 characters.", fields: { note: ["Keep the note under 500 characters."] } });
  });
});

describe("M3: telling the engineer", () => {
  it("gives up on a send that doesn't answer, so the next is still tried", async () => {
    vi.useFakeTimers();
    try {
      const hung = withTimeout(new Promise(() => {}), 10_000);
      const settled = expect(hung).rejects.toThrow("No answer after 10000 ms");
      await vi.advanceTimersByTimeAsync(10_001);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("happens after the decision is saved, and a failure doesn't undo it", async () => {
    const order: string[] = [];
    sent.push.mockImplementationOnce(async () => {
      order.push(`push, verified ${Boolean((await prisma.engineer.findFirstOrThrow()).gasSafeVerifiedAt)}`);
      throw new Error("Expo is down");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    log.mockRestore();
    expect(res.status).toBe(200);
    expect(order).toEqual(["push, verified true"]);
    expect(sent.sms).toHaveBeenCalledTimes(1);
  });
});

describe("M4: sorting the engineer list", () => {
  it("counts the engineer's own live plans and customers on a plan, as the record does", async () => {
    const e = await makeEngineer();
    for (const status of ["LIVE", "LIVE", "DRAFT"] as const) {
      await prisma.planTier.create({ data: { engineerId: e.id, name: "Care", priceMonthlyPence: 1500, sortOrder: 0, status } });
    }
    const [c1, c2, c3] = [await makeCustomer(e.id), await makeCustomer(e.id), await makeCustomer(e.id)];
    await makePlan(e.id, c1.id);
    await makePlan(e.id, c2.id, { status: "PAUSED" });
    await makePlan(e.id, c3.id, { status: "CANCELLED" });
    const row = (await call(engineers)).body.items[0];
    expect(row).toMatchObject({ tiersLive: 2, customersOnPlans: 2, plansLive: 1, customers: 3 });
    expect((await call(engineer, { params: { engineerId: e.id } })).body.counts).toMatchObject({ tiersLive: 2, customersOnPlans: 2 });
  });

  it("sorts by the value each column shows", async () => {
    const quiet = await makeEngineer({ tradingName: "Zebra Heating" });
    const busy = await makeEngineer({ tradingName: null, legalName: "Acme Boilers Ltd" });
    const middling = await makeEngineer({ tradingName: "  ", legalName: "Middle Gas" });
    for (const [e, n] of [[busy, 3], [middling, 1]] as const) {
      for (let i = 0; i < n; i++) {
        const c = await makeCustomer(e.id);
        await makePlan(e.id, c.id, { createdAt: new Date(Date.UTC(2026, 9, 10 + i + (e === busy ? 5 : 0))) });
        await prisma.planTier.create({ data: { engineerId: e.id, name: "Care", priceMonthlyPence: 1500, sortOrder: i, status: "LIVE" } });
      }
    }
    expect(ids(await call(engineers, { query: { sort: "plans", dir: "desc" } }))).toEqual([busy.id, middling.id, quiet.id]);
    expect(ids(await call(engineers, { query: { sort: "tiers", dir: "asc" } }))).toEqual([quiet.id, middling.id, busy.id]);
    expect(ids(await call(engineers, { query: { sort: "customersOnPlans", dir: "desc" } }))).toEqual([busy.id, middling.id, quiet.id]);
    // Never offered sorts last whichever way.
    expect(ids(await call(engineers, { query: { sort: "lastOffer", dir: "desc" } }))).toEqual([busy.id, middling.id, quiet.id]);
    expect(ids(await call(engineers, { query: { sort: "lastOffer", dir: "asc" } }))).toEqual([middling.id, busy.id, quiet.id]);
    // By the business name as shown: Acme Boilers Ltd, Middle Gas, Zebra Heating.
    expect(ids(await call(engineers, { query: { sort: "business" } }))).toEqual([busy.id, middling.id, quiet.id]);
    const paged = await call(engineers, { query: { sort: "business", size: "2", page: "2" } });
    expect(ids(paged)).toEqual([quiet.id]);
    expect(paged.body.total).toBe(3);
  });
});

describe("M4: sorting the customer list", () => {
  it("sorts by price, postcode, engineer and plan start, as shown", async () => {
    const zed = await makeEngineer({ tradingName: "Zed Gas" });
    const abc = await makeEngineer({ tradingName: "ABC Heating" });
    const cheap = await makeCustomer(zed.id, { properties: { create: { addressLine1: "1 Low St", postcode: "ZZ1 1AA" } } });
    const dear = await makeCustomer(abc.id, { properties: { create: { addressLine1: "2 High St", postcode: "AA1 1AA" } } });
    const none = await makeCustomer(abc.id);
    await makePlan(zed.id, cheap.id, { priceMonthlyPence: 900, activatedAt: new Date("2026-09-01") });
    await makePlan(abc.id, dear.id, { priceMonthlyPence: 2500, activatedAt: new Date("2026-10-01") });
    await makePlan(abc.id, dear.id, { priceMonthlyPence: 9900, status: "CANCELLED", activatedAt: new Date("2026-01-01") });
    expect(ids(await call(customers, { query: { sort: "price", dir: "desc" } }))).toEqual([dear.id, cheap.id, none.id]);
    expect(ids(await call(customers, { query: { sort: "postcode", dir: "asc" } }))).toEqual([dear.id, cheap.id, none.id]);
    expect(ids(await call(customers, { query: { sort: "postcode", dir: "desc" } }))).toEqual([cheap.id, dear.id, none.id]);
    expect(ids(await call(customers, { query: { sort: "engineer", dir: "asc" } })).at(-1)).toBe(cheap.id);
    const since = ids(await call(customers, { query: { sort: "since", dir: "asc" } }));
    expect(since.indexOf(cheap.id)).toBeLessThan(since.indexOf(dear.id));
  });
});

describe("M4: sorting the verification queue", () => {
  it("sorts by the business name as shown, waiting or decided", async () => {
    const b = await makeEngineer({ tradingName: "Beta Gas" });
    const a = await makeEngineer({ tradingName: null, legalName: "Alpha Ltd" });
    expect(ids(await call(verifications, { as: CHECKER, query: { tab: "pending", sort: "business" } }))).toEqual([a.id, b.id]);
    expect(ids(await call(verifications, { as: CHECKER, query: { tab: "pending", sort: "business", dir: "desc" } }))).toEqual([b.id, a.id]);
    const d1 = await makeEngineer({ tradingName: "Delta", gasSafeVerifiedAt: new Date() });
    const c1 = await makeEngineer({ tradingName: "Charlie", gasSafeRejectedAt: new Date(), gasSafeRejectReason: "x" });
    expect(ids(await call(verifications, { as: CHECKER, query: { tab: "decided", sort: "business" } }))).toEqual([c1.id, d1.id]);
    expect(ids(await call(verifications, { as: CHECKER, query: { tab: "verified", sort: "business" } }))).toEqual([d1.id]);
  });
});

describe("M6: a stale view", () => {
  it("can't decide an application that changed after it was opened", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: "https://x.public.blob.vercel-storage.com/old.jpg" });
    const { revision } = (await call(verification, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(revision).toMatch(/^[0-9a-f]{16}$/);
    await prisma.engineer.update({ where: { id: e.id }, data: { gasSafeCardUrl: "https://x.public.blob.vercel-storage.com/new.jpg" } });
    const stale = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", revision } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.message).toMatch(/changed while you had it open/);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeVerifiedAt).toBeNull();

    const fresh = (await call(verification, { as: CHECKER, params: { engineerId: e.id } })).body.revision;
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", revision: fresh } })).status).toBe(200);
  });

  it("still says it's already decided, rather than changed", async () => {
    const e = await makeEngineer();
    const { revision } = (await call(verification, { as: CHECKER, params: { engineerId: e.id } })).body;
    await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    const again = await call(decide, { as: other, params: { engineerId: e.id }, body: { decision: "approve", revision } });
    expect(again.body.error.message).toMatch(/already been decided/);
  });
});

describe("L1: a NUL character", () => {
  it("is refused with a 400, in a search, an ID or a body", async () => {
    const e = await makeEngineer();
    expect((await call(engineers, { query: { q: "ab\u0000cd" } })).status).toBe(400);
    expect((await call(engineer, { params: { engineerId: "ab\u0000cd" } })).status).toBe(400);
    const res = await call(engineerNote, { params: { engineerId: e.id }, body: { body: "a\u0000b" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION");
  });
});

describe("L2: search wildcards", () => {
  it("are taken literally, and the count agrees with the list", async () => {
    await makeEngineer({ tradingName: "Smith Heating" });
    await makeEngineer({ tradingName: "100% Gas" });
    await makeEngineer({ tradingName: "A_B Plumbing", gasSafeVerifiedAt: new Date() });
    expect((await call(engineers, { query: { q: "%" } })).body.total).toBe(1);
    expect((await call(engineers, { query: { q: "_" } })).body.total).toBe(1);
    const decided = await call(verifications, { as: CHECKER, query: { tab: "decided", q: "%" } });
    expect({ items: decided.body.items.length, total: decided.body.total }).toEqual({ items: 0, total: 0 });
    expect((await call(customers, { query: { q: "%" } })).body.total).toBe(0);
  });
});

describe("L3: dates far outside TradeSura's", () => {
  it("are refused with a 400, not a 500", async () => {
    const res = await call(signupsRoute, { query: { from: "0001-01-01T00:00:00.000Z", to: "0001-01-31T00:00:00.000Z" } });
    expect(res.status).toBe(400);
    expect((await call(engineers, { query: { joinedFrom: "0001-01-01" } })).status).toBe(400);
  });
});

describe("L5: CSV exports", () => {
  it("stream every match in one request, ending with a count", async () => {
    const e = await makeEngineer();
    await makeEngineer({ pausedAt: new Date() });
    for (let i = 0; i < 3; i++) await makeCustomer(e.id);
    const res = await call(engineerExport, { query: { status: "active" } });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (res.body as string).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ id: e.id, customers: 3 });
    expect(lines.at(-1)).toEqual({ end: true, count: 1 });

    const all = (await call(customerExport)).body.trim().split("\n");
    expect(JSON.parse(all.at(-1))).toEqual({ end: true, count: 3 });
  });

  it("read in batches, however many there are", async () => {
    for (let i = 0; i < 5; i++) await makeEngineer();
    const batches: number[] = [];
    for await (const batch of exportEngineers({}, 2)) batches.push(batch.length);
    expect(batches).toEqual([2, 2, 1]);
  });
});

describe("L7: revealing a staff member's contact details", () => {
  it("only works for someone on that engineer's team, and records whose record it was", async () => {
    const owner = await makeEngineer();
    const staff = await makeEngineer({ ownerId: owner.id, email: "staff@team.example" });
    const stranger = await makeEngineer();
    expect((await call(engineerContact, { params: { engineerId: stranger.id }, query: { staffId: staff.id } })).status).toBe(404);
    const res = await call(engineerContact, { params: { engineerId: owner.id }, query: { staffId: staff.id, field: "email" } });
    expect(res.body).toEqual({ email: "staff@team.example" });
    const event = await prisma.event.findFirstOrThrow({ where: { name: "admin_contact_revealed" } });
    expect(event.meta).toMatchObject({ subjectType: "engineer", subjectId: owner.id, engineerId: owner.id, staffId: staff.id, field: "email" });
  });

  it("can be one field of a customer's, recorded as that field", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id);
    expect((await call(customerContact, { params: { customerId: c.id }, query: { field: "phone" } })).body).toEqual({ phone: c.phone });
    expect((await prisma.event.findFirstOrThrow({ where: { name: "admin_contact_revealed" } })).meta).toMatchObject({ field: "phone" });
  });
});

describe("L8: deleting a note", () => {
  it("is for the note's author or a super-admin", async () => {
    const e = await makeEngineer();
    const support = { ...withPermissions("engineers:read", "engineers:notes"), id: "adm_test_support", role: "support" };
    const colleague = { ...support, id: "adm_test_colleague", name: "Colleague" };
    const note = (await call(engineerNote, { as: support, params: { engineerId: e.id }, body: { body: "Called about their card" } })).body;
    const params = { engineerId: e.id, noteId: note.id };
    expect((await call(deleteEngineerNote, { as: colleague, params, method: "DELETE" })).status).toBe(403);
    expect((await call(deleteEngineerNote, { as: support, params, method: "DELETE" })).status).toBe(200);
    const second = (await call(engineerNote, { as: support, params: { engineerId: e.id }, body: { body: "Another" } })).body;
    expect((await call(deleteEngineerNote, { as: SUPER_ADMIN, params: { engineerId: e.id, noteId: second.id }, method: "DELETE" })).status).toBe(200);
  });
});

describe("member packs, for the admin's backend mode", () => {
  const requested = { packAddress: "1 High Street\nLeeds\nLS1 4AB", packRequestedAt: new Date("2026-10-01") };

  it("can be searched", async () => {
    const a = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date(), tradingName: "Leeds Gas" });
    await makeEngineer({ ...requested, packAddress: "2 Low Road\nYork\nYO1 1AA", gasSafeVerifiedAt: new Date() });
    expect(ids(await call(packs, { query: { q: "LS1" } }))).toEqual([a.id]);
    expect((await call(packs, { query: { q: "leeds gas" } })).body.items[0]).toMatchObject({ id: a.id, businessType: null });
  });

  it("can be marked posted together on a day, with the ones that can't go listed", async () => {
    const ready = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date() });
    const unverified = await makeEngineer(requested);
    const res = await call(packsPosted, { body: { engineerIds: [ready.id, unverified.id, "nope"], postedOn: "2026-10-20" } });
    expect(res.status).toBe(200);
    expect(res.body.posted).toEqual([ready.id]);
    expect(res.body.skipped).toEqual([
      { id: unverified.id, reason: "This pack can't go out until the engineer is Gas Safe verified." },
      { id: "nope", reason: "There's no engineer with that ID." },
    ]);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: ready.id } })).packShippedAt?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(await prisma.event.count({ where: { name: "member_pack_shipped" } })).toBe(1);
    const again = await call(packsPosted, { body: { engineerIds: [ready.id] } });
    expect(again.body.skipped).toEqual([{ id: ready.id, reason: "This pack has already been marked as posted." }]);
  });

  it("can't be posted on a day in the future", async () => {
    const ready = await makeEngineer({ ...requested, gasSafeVerifiedAt: new Date() });
    expect((await call(packsPosted, { body: { engineerIds: [ready.id], postedOn: "2099-01-01" } })).status).toBe(400);
  });
});
