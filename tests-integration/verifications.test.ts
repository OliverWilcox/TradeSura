import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/verifications/route";
import { GET as detail } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { GET as card } from "@/app/api/admin/v1/verifications/[engineerId]/card/route";
import { POST as decide } from "@/app/api/admin/v1/verifications/[engineerId]/decision/route";
import { POST as claim } from "@/app/api/admin/v1/verifications/[engineerId]/claim/route";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeEngineer } from "./factories";

// The Gas Safe queue through the admin API: the same queue and rules as the
// old /admin/verifications page, plus who decided and a guard against two
// admins deciding the same application.

const sent = vi.hoisted(() => ({ push: vi.fn(), sms: vi.fn(), email: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotification: sent.push }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: sent.sms }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("the verification queue", () => {
  it("lists waiting applications oldest first, and counts each tab", async () => {
    const newer = await makeEngineer({ createdAt: new Date("2026-10-20T10:00:00Z") });
    const older = await makeEngineer({ createdAt: new Date("2026-10-18T10:00:00Z") });
    await makeEngineer({ gasSafeVerifiedAt: new Date() });
    await makeEngineer({ gasSafeRejectedAt: new Date(), gasSafeRejectReason: "Card unreadable" });
    await makeEngineer({ gasSafeNo: null }); // hasn't submitted
    await makeEngineer({ deletedAt: new Date() }); // deleted account

    const res = await call(list, { as: CHECKER });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([older.id, newer.id]);
    expect(res.body.total).toBe(2);
    expect(res.body.counts).toEqual({ new: 2, duplicates: 0, pending: 2, verified: 1, rejected: 1, decided: 2 });
  });

  it("splits the waiting queue into new applications and flagged duplicates", async () => {
    await makeEngineer({ businessType: "ltd", companyNumber: "12345678", gasSafeVerifiedAt: new Date() });
    const flagged = await makeEngineer({ businessType: "ltd", companyNumber: "12345678" });
    const clean = await makeEngineer();
    expect((await call(list, { as: CHECKER, query: { tab: "new" } })).body.items.map((i: { id: string }) => i.id)).toEqual([clean.id]);
    const dupes = await call(list, { as: CHECKER, query: { tab: "duplicates" } });
    expect(dupes.body.items.map((i: { id: string }) => i.id)).toEqual([flagged.id]);
    expect(dupes.body.counts).toMatchObject({ new: 1, duplicates: 1, pending: 2 });
  });

  it("lists every decision, latest first, in the decided tab", async () => {
    const verifiedEarly = await makeEngineer({ gasSafeVerifiedAt: new Date("2026-10-01") });
    const rejectedMid = await makeEngineer({ gasSafeRejectedAt: new Date("2026-10-05"), gasSafeRejectReason: "Unreadable" });
    const verifiedLate = await makeEngineer({ gasSafeVerifiedAt: new Date("2026-10-09") });
    const res = await call(list, { as: CHECKER, query: { tab: "decided" } });
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([verifiedLate.id, rejectedMid.id, verifiedEarly.id]);
    expect(res.body.total).toBe(3);
  });

  it("shows decided applications in their own tabs", async () => {
    const rejected = await makeEngineer({ gasSafeRejectedAt: new Date(), gasSafeRejectReason: "Card unreadable" });
    const res = await call(list, { as: CHECKER, query: { tab: "rejected" } });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: rejected.id, status: "rejected", rejectReason: "Card unreadable" });
  });

  it("searches by name and Gas Safe number", async () => {
    const dave = await makeEngineer({ firstName: "Dave", lastName: "Hartley", gasSafeNo: "584123" });
    await makeEngineer({ firstName: "Priya", lastName: "Kaur", gasSafeNo: "771001" });
    expect((await call(list, { as: CHECKER, query: { q: "hartley" } })).body.items.map((i: { id: string }) => i.id)).toEqual([dave.id]);
    expect((await call(list, { as: CHECKER, query: { q: "584 123" } })).body.items.map((i: { id: string }) => i.id)).toEqual([dave.id]);
  });

  it("checks each number against the register", async () => {
    await prisma.gasSafeRecord.createMany({
      data: [
        { regNo: "584123", name: "D. Hartley", company: "Hartley Heating", categories: "Boilers" },
        { regNo: "584124", name: "S. Jones", company: "Jones Gas", categories: "Boilers" },
      ],
    });
    await makeEngineer({ firstName: "Dave", lastName: "Hartley", gasSafeNo: "584123" });
    await makeEngineer({ firstName: "Dave", lastName: "Hartley2", gasSafeNo: "584124" });
    await makeEngineer({ gasSafeNo: "999999" });
    const signals = (await call(list, { as: CHECKER })).body.items.map((i: { signals: { register: string } }) => i.signals.register);
    expect(signals).toEqual(["match", "name_mismatch", "not_found"]);
  });

  it("flags another account with the same company number", async () => {
    const existing = await makeEngineer({ businessType: "ltd", companyNumber: "12345678", gasSafeVerifiedAt: new Date() });
    const applicant = await makeEngineer({ businessType: "ltd", companyNumber: "12345678" });
    expect((await call(list, { as: CHECKER })).body.items[0].signals.duplicates).toBe(1);
    const res = await call(detail, { as: CHECKER, params: { engineerId: applicant.id } });
    expect(res.body.duplicates).toEqual([expect.objectContaining({ engineerId: existing.id, reason: "company_number", status: "verified" })]);
  });

  it("can't be read without verification access", async () => {
    expect((await call(list, { as: withPermissions("engineers:read") })).status).toBe(403);
  });
});

describe("an application", () => {
  it("shows what the check needs, but never contact details", async () => {
    const e = await makeEngineer({
      email: "dave.private@example.test",
      phone: "+447700900999",
      qualificationConfirmations: { GAS_FIRE_SERVICE: "2026-10-02T09:00:00.000Z" },
    });
    const res = await call(detail, { as: CHECKER, params: { engineerId: e.id } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: e.id, status: "pending", standing: "CHECK_PENDING", gasSafe: { number: e.gasSafeNo }, card: { available: false } });
    expect(res.body.qualifications).toHaveLength(1);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("dave.private@example.test");
    expect(json).not.toContain("+447700900999");
  });

  it("says where it sits in the queue", async () => {
    const a = await makeEngineer({ createdAt: new Date("2026-10-01T09:00:00Z") });
    const b = await makeEngineer({ createdAt: new Date("2026-10-02T09:00:00Z") });
    const c = await makeEngineer({ createdAt: new Date("2026-10-03T09:00:00Z") });
    const res = await call(detail, { as: CHECKER, params: { engineerId: b.id } });
    expect(res.body.queue).toEqual({ position: 2, total: 3, previousId: a.id, nextId: c.id });
  });

  it("is a 404 when there's no such engineer", async () => {
    const res = await call(detail, { as: CHECKER, params: { engineerId: "nope" } });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("deciding an application", () => {
  it("approves it, records who did, tells the engineer and points to the next one", async () => {
    const e = await makeEngineer({ createdAt: new Date("2026-10-01T09:00:00Z") });
    const nextUp = await makeEngineer({ createdAt: new Date("2026-10-02T09:00:00Z") });
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" }, headers: { "x-request-id": "req-approve-1" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: e.id, outcome: "verified", nextId: nextUp.id });

    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeVerifiedAt).not.toBeNull();
    const event = await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_verified" } });
    expect(event).toMatchObject({ actorType: "ADMIN", actorId: CHECKER.id });
    expect(event.meta).toMatchObject({ engineerId: e.id, via: "admin_api", adminName: CHECKER.name, requestId: "req-approve-1" });
    expect(sent.push).toHaveBeenCalledWith(e.id, "You're verified", expect.any(String), { url: "/more" });
    expect(sent.sms).toHaveBeenCalledTimes(1);
    expect(sent.email).toHaveBeenCalledWith(expect.objectContaining({ to: e.email, subject: "You're Gas Safe verified on TradeSura" }));

    const after = await call(detail, { as: CHECKER, params: { engineerId: e.id } });
    expect(after.body.decision).toMatchObject({ outcome: "verified", byName: CHECKER.name });
  });

  it("points to the next one in the same tab, skipping flagged duplicates", async () => {
    await makeEngineer({ businessType: "ltd", companyNumber: "87654321", gasSafeVerifiedAt: new Date() });
    const deciding = await makeEngineer({ createdAt: new Date("2026-10-01T09:00:00Z") });
    await makeEngineer({ businessType: "ltd", companyNumber: "87654321", createdAt: new Date("2026-10-02T09:00:00Z") }); // older, but a flagged duplicate
    const nextNew = await makeEngineer({ createdAt: new Date("2026-10-03T09:00:00Z") });
    const res = await call(decide, { as: CHECKER, params: { engineerId: deciding.id }, body: { decision: "approve" } });
    expect(res.body.nextId).toBe(nextNew.id);
  });

  it("rejects it with a reason", async () => {
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Name on the card doesn't match" } });
    expect(res.body.outcome).toBe("rejected");
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeRejectReason).toBe("Name on the card doesn't match");
    expect(sent.email).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining("Name on the card doesn&#39;t match".replace("&#39;", "'")) }));
  });

  it("needs a reason to reject", async () => {
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject" } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.reason).toEqual(["Say why it was rejected."]);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRejectedAt).toBeNull();
  });

  it("can only happen once", async () => {
    const e = await makeEngineer();
    await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    const again = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Changed my mind" } });
    expect(again.status).toBe(409);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRejectedAt).toBeNull();
  });

  it("stands even if telling the engineer fails", async () => {
    sent.email.mockRejectedValueOnce(new Error("Resend is down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(res.status).toBe(200);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeVerifiedAt).not.toBeNull();
    log.mockRestore();
  });

  it("needs the decide permission", async () => {
    const e = await makeEngineer();
    const res = await call(decide, { as: withPermissions("verification:read"), params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(res.status).toBe(403);
  });
});

describe("claiming an application", () => {
  const other = { ...CHECKER, id: "adm_test_other", name: "Other Checker" };

  it("holds it for the admin checking it, and tells anyone else who has it", async () => {
    const e = await makeEngineer();
    const mine = await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    expect(mine.body).toMatchObject({ claimed: true, lock: { holderId: CHECKER.id, holderName: CHECKER.name } });
    const theirs = await call(claim, { as: other, params: { engineerId: e.id }, method: "POST" });
    expect(theirs.body).toMatchObject({ claimed: false, lock: { holderName: CHECKER.name } });
    expect((await call(detail, { as: other, params: { engineerId: e.id } })).body.lock.holderName).toBe(CHECKER.name);
    expect((await call(list, { as: other })).body.items[0].claimedBy).toBe(CHECKER.name);
  });

  it("stops anyone else deciding it, and ends when it's decided", async () => {
    const e = await makeEngineer();
    await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    const blocked = await call(decide, { as: other, params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain(CHECKER.name);
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } })).status).toBe(200);
    expect(await prisma.verificationClaim.count()).toBe(0);
  });

  it("runs out after 15 minutes", async () => {
    const e = await makeEngineer();
    await prisma.verificationClaim.create({ data: { engineerId: e.id, adminId: CHECKER.id, adminName: CHECKER.name, claimedAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await call(claim, { as: other, params: { engineerId: e.id }, method: "POST" })).body.claimed).toBe(true);
  });

  it("records the start of a check once, not every refresh", async () => {
    const e = await makeEngineer();
    await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    expect(await prisma.event.count({ where: { name: "verification_claimed" } })).toBe(1);
  });

  it("isn't possible once it's decided", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date() });
    expect((await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" })).body).toEqual({ claimed: false, lock: null });
  });
});

describe("rejecting a duplicate", () => {
  it("records which account it duplicates", async () => {
    const existing = await makeEngineer({ gasSafeVerifiedAt: new Date() });
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Duplicate of an existing account", duplicateOf: existing.id } });
    expect(res.status).toBe(200);
    const event = await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_rejected" } });
    expect(event.meta).toMatchObject({ engineerId: e.id, duplicateOf: existing.id });
  });

  it("needs the other account to exist", async () => {
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Duplicate", duplicateOf: "nope" } });
    expect(res.status).toBe(404);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRejectedAt).toBeNull();
  });
});

describe("the ID card photo", () => {
  it("is fetched from Blob storage on the server", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: "https://abc123.public.blob.vercel-storage.com/gas-safe-cards/card-x1y2.jpg" });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } }));
    const res = await call(card, { as: CHECKER, params: { engineerId: e.id } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    fetchSpy.mockRestore();
  });

  it("is never fetched from anywhere else", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await makeEngineer({ gasSafeCardUrl: "http://169.254.169.254/latest/meta-data/" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call(card, { as: CHECKER, params: { engineerId: e.id } });
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    log.mockRestore();
  });
});
