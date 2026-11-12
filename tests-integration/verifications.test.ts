import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/verifications/route";
import { GET as detail } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { GET as card } from "@/app/api/admin/v1/verifications/[engineerId]/card/route";
import { POST as decide } from "@/app/api/admin/v1/verifications/[engineerId]/decision/route";
import { POST as claim } from "@/app/api/admin/v1/verifications/[engineerId]/claim/route";
import { POST as registerCheck } from "@/app/api/admin/v1/verifications/[engineerId]/register-check/route";
import { POST as suspend } from "@/app/api/admin/v1/verifications/[engineerId]/suspend/route";
import { POST as recheck } from "@/app/api/admin/v1/verifications/[engineerId]/recheck/route";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeEngineer } from "./factories";

/** A card photo where the check expects one. */
const CARD = "https://x.public.blob.vercel-storage.com/card.png";
const withCard = (data: Parameters<typeof makeEngineer>[0] = {}) => makeEngineer({ gasSafeCardUrl: CARD, ...data });
/** Live: the card check passed, the register check not done yet. */
const live = (data: Parameters<typeof makeEngineer>[0] = {}) => withCard({ gasSafeVerifiedAt: new Date("2026-11-01T09:00:00Z"), ...data });
/** Live with the register check passed. */
const checked = (data: Parameters<typeof makeEngineer>[0] = {}) => live({ gasSafeRegisterCheckedAt: new Date("2026-11-01T15:00:00Z"), ...data });
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

// The Gas Safe check through the admin API, live first with the register
// check behind (Matt, 4 Nov), with who decided each step and a guard against
// two admins deciding the same case.

const sent = vi.hoisted(() => ({ push: vi.fn(), sms: vi.fn(), email: vi.fn(), offered: vi.fn(async () => ({ offered: 2 })) }));
vi.mock("@/lib/push", () => ({ sendPushNotification: sent.push }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: sent.sms, smsConfigured: () => true }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email, emailConfigured: () => true }));
vi.mock("@/lib/installer-leaves", () => ({ offerNearbyEngineers: sent.offered }));

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

describe("the queue", () => {
  it("puts each stage in its own tab, longest waiting first, and counts them", async () => {
    const newer = await withCard({ createdAt: new Date("2026-10-20T10:00:00Z") });
    const older = await withCard({ createdAt: new Date("2026-10-18T10:00:00Z") });
    const due = await live();
    const noCard = await makeEngineer();
    const recheck = await checked({ gasSafeRecheckRequestedAt: new Date(), gasSafeRecheckReason: "Homeowner safety complaint" });
    await checked();
    await makeEngineer({ gasSafeRejectedAt: new Date(), gasSafeRejectReason: "Card unreadable" });
    await makeEngineer({ gasSafeRejectedAt: new Date(), gasSafeSuspendedAt: new Date(), gasSafeRejectReason: "Not on the register" });
    await makeEngineer({ gasSafeNo: null }); // hasn't submitted
    await withCard({ deletedAt: new Date() }); // deleted account

    expect(ids(await call(list, { as: CHECKER, query: { tab: "card" } }))).toEqual([older.id, newer.id]);
    expect(ids(await call(list, { as: CHECKER, query: { tab: "register" } }))).toEqual([due.id]);
    expect(ids(await call(list, { as: CHECKER, query: { tab: "no_card" } }))).toEqual([noCard.id]);
    const res = await call(list, { as: CHECKER, query: { tab: "recheck" } });
    expect(ids(res)).toEqual([recheck.id]);
    expect(res.body.items[0]).toMatchObject({ cardCheck: "passed", registerCheck: "recheck_due", recheckReason: "Homeowner safety complaint" });
    expect(res.body.counts).toEqual({ card: 2, register: 1, no_card: 1, recheck: 1, duplicates: 0, pending: 4, decided: 4 });
  });

  it("shows the card check and the register check, not one status", async () => {
    await live();
    const [row] = (await call(list, { as: CHECKER, query: { tab: "register" } })).body.items;
    expect(row).toMatchObject({ stage: "register", cardCheck: "passed", registerCheck: "due", liveSince: "2026-11-01T09:00:00.000Z", waitingSince: "2026-11-01T09:00:00.000Z" });
  });

  it("flags duplicates by company number, Gas Safe registration number and business name, but not staff of the same business", async () => {
    const owner = await checked({ businessType: "ltd", companyNumber: "12345678", tradingName: "Smith Heating Ltd", gasSafeRegistrationNo: "584123" });
    const sameCompany = await withCard({ businessType: "ltd", companyNumber: "12345678" });
    const sameName = await withCard({ tradingName: "SMITH HEATING LIMITED" });
    const sameRegistration = await withCard({ gasSafeRegistrationNo: "584123" });
    await withCard({ ownerId: owner.id, tradingName: "Smith Heating Ltd" }); // staff
    const clean = await withCard();
    const dupes = await call(list, { as: CHECKER, query: { tab: "duplicates" } });
    expect(new Set(ids(dupes))).toEqual(new Set([sameCompany.id, sameName.id, sameRegistration.id]));
    expect(ids(await call(list, { as: CHECKER, query: { tab: "card" } }))).toContain(clean.id);
    const reasons = async (id: string) => (await call(detail, { as: CHECKER, params: { engineerId: id } })).body.duplicates.map((d: { reason: string }) => d.reason);
    expect(await reasons(sameCompany.id)).toEqual(["company_number"]);
    expect(await reasons(sameName.id)).toEqual(["business_name"]);
    expect(await reasons(sameRegistration.id)).toEqual(["registration_number"]);
  });

  it("lists every decision, latest first, in the decided tab", async () => {
    const passedEarly = await checked({ gasSafeRegisterCheckedAt: new Date("2026-10-01") });
    const rejectedMid = await makeEngineer({ gasSafeRejectedAt: new Date("2026-10-05"), gasSafeRejectReason: "Unreadable" });
    const suspendedLate = await makeEngineer({ gasSafeRejectedAt: new Date("2026-10-09"), gasSafeSuspendedAt: new Date("2026-10-09"), gasSafeRejectReason: "Not on the register" });
    const res = await call(list, { as: CHECKER, query: { tab: "decided" } });
    expect(ids(res)).toEqual([suspendedLate.id, rejectedMid.id, passedEarly.id]);
    expect(res.body.items.map((i: { registerCheck: string | null }) => i.registerCheck)).toEqual(["suspended", null, "passed"]);
  });

  it("searches by name, licence number and registration number", async () => {
    const dave = await withCard({ firstName: "Dave", lastName: "Hartley", gasSafeNo: "5841230", gasSafeRegistrationNo: "771001" });
    await withCard({ firstName: "Priya", lastName: "Kaur", gasSafeNo: "7710020" });
    expect(ids(await call(list, { as: CHECKER, query: { q: "hartley" } }))).toEqual([dave.id]);
    expect(ids(await call(list, { as: CHECKER, query: { q: "584 1230" } }))).toEqual([dave.id]);
    expect(ids(await call(list, { as: CHECKER, query: { q: "771001" } }))).toEqual([dave.id]);
  });

  it("can't be read without verification access", async () => {
    expect((await call(list, { as: withPermissions("engineers:read") })).status).toBe(403);
  });
});

describe("a case", () => {
  it("shows what the check needs, both Gas Safe numbers, and never contact details or a stored register", async () => {
    await prisma.gasSafeRecord.create({ data: { regNo: "1234567", name: "D. Smith", company: "Smith Heating", categories: "Boilers" } });
    const e = await withCard({
      email: "dave.private@example.test",
      phone: "+447700900999",
      gasSafeNo: "1234567",
      gasSafeRegistrationNo: "584123",
      qualificationConfirmations: { GAS_FIRE_SERVICE: "2026-10-02T09:00:00.000Z" },
    });
    const res = await call(detail, { as: CHECKER, params: { engineerId: e.id } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: e.id, stage: "card", tab: "card", standing: "CHECK_PENDING", checks: { card: "waiting", register: null }, gasSafe: { licenceNo: "1234567", registrationNo: "584123" }, card: { available: true } });
    expect(res.body.qualifications).toHaveLength(1);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain("dave.private@example.test");
    expect(json).not.toContain("+447700900999");
    expect(json).not.toContain("onRegister");
    expect(json).not.toContain("D. Smith");
  });

  it("says where it sits in its tab", async () => {
    const a = await withCard({ createdAt: new Date("2026-10-01T09:00:00Z") });
    const b = await withCard({ createdAt: new Date("2026-10-02T09:00:00Z") });
    const c = await withCard({ createdAt: new Date("2026-10-03T09:00:00Z") });
    await live(); // another tab
    const res = await call(detail, { as: CHECKER, params: { engineerId: b.id } });
    expect(res.body.queue).toEqual({ position: 2, total: 3, previousId: a.id, nextId: c.id });
  });

  it("is a 404 when there's no such engineer", async () => {
    const res = await call(detail, { as: CHECKER, params: { engineerId: "nope" } });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("the card check", () => {
  it("passing it puts them live straight away, records who did, tells them and points to the next one", async () => {
    const e = await withCard({ createdAt: new Date("2026-10-01T09:00:00Z") });
    const nextUp = await withCard({ createdAt: new Date("2026-10-02T09:00:00Z") });
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" }, headers: { "x-request-id": "req-approve-1" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: e.id, outcome: "verified", nextId: nextUp.id });

    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeVerifiedAt).not.toBeNull();
    expect(row.gasSafeRegisterCheckedAt).toBeNull();
    const event = await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_verified" } });
    expect(event).toMatchObject({ actorType: "ADMIN", actorId: CHECKER.id });
    expect(event.meta).toMatchObject({ engineerId: e.id, via: "admin_api", adminName: CHECKER.name, requestId: "req-approve-1", before: "card" });
    expect(sent.push).toHaveBeenCalledWith(e.id, "You're live", expect.any(String), { url: "/more" });
    expect(sent.sms).toHaveBeenCalledTimes(1);
    // The designed "You're verified" email goes at the live moment, not from the daily job.
    expect(sent.email).toHaveBeenCalledWith(expect.objectContaining({ to: e.email, subject: expect.stringMatching(/^You're verified/), html: expect.stringContaining("verified-member-badge.png") }));
    expect(await prisma.event.findFirst({ where: { name: "verified_email_sent" } })).toMatchObject({ meta: expect.objectContaining({ engineerId: e.id }) });

    const after = await call(detail, { as: CHECKER, params: { engineerId: e.id } });
    expect(after.body).toMatchObject({ stage: "register", tab: "register", checks: { card: "passed", register: "due" } });
    expect(after.body.history[0]).toMatchObject({ kind: "card_passed", byName: CHECKER.name });
  });

  it("live again, once the designed email has gone, gets a plain notice", async () => {
    const e = await withCard();
    await prisma.event.create({ data: { name: "verified_email_sent", actorType: "SYSTEM", meta: { engineerId: e.id } } });
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(res.status).toBe(200);
    expect(sent.email).toHaveBeenCalledTimes(1);
    expect(sent.email).toHaveBeenCalledWith(expect.objectContaining({ to: e.email, subject: "You're live on TradeSura", html: expect.stringContaining("lockup-dark.png") }));
    expect(await prisma.event.count({ where: { name: "verified_email_sent" } })).toBe(1);
  });

  it("can't pass without a card photo", async () => {
    const e = await makeEngineer();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", reason: "Saw it on a call" } });
    expect(res.status).toBe(409);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeVerifiedAt).toBeNull();
  });

  it("fails it with a reason", async () => {
    const e = await withCard();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Name on the card doesn't match" } });
    expect(res.body.outcome).toBe("rejected");
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeRejectReason).toBe("Name on the card doesn't match");
    expect(sent.email).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining("Name on the card doesn&#39;t match".replace("&#39;", "'")) }));
  });

  it("needs a reason to fail", async () => {
    const e = await withCard();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject" } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.reason).toEqual(["Say why it was rejected."]);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRejectedAt).toBeNull();
  });

  it("can only happen once", async () => {
    const e = await withCard();
    await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    const again = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Changed my mind" } });
    expect(again.status).toBe(409);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRejectedAt).toBeNull();
  });

  it("stands even if telling the engineer fails", async () => {
    sent.email.mockRejectedValueOnce(new Error("Resend is down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await withCard();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(res.status).toBe(200);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeVerifiedAt).not.toBeNull();
    log.mockRestore();
  });

  it("needs the decide permission", async () => {
    const e = await withCard();
    const res = await call(decide, { as: withPermissions("verification:read"), params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(res.status).toBe(403);
  });
});

describe("the register check", () => {
  it("passes for a live engineer, with what the register showed, and moves on to the next", async () => {
    const e = await live({ gasSafeVerifiedAt: new Date("2026-11-01T09:00:00Z") });
    const nextUp = await live({ gasSafeVerifiedAt: new Date("2026-11-02T09:00:00Z") });
    const res = await call(registerCheck, { as: CHECKER, params: { engineerId: e.id }, body: { note: "Matches: name, business and categories" } });
    expect(res.status).toBe(200);
    expect(res.body.nextId).toBe(nextUp.id);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRegisterCheckedAt).not.toBeNull();
    const event = await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_register_checked" } });
    expect(event.meta).toMatchObject({ engineerId: e.id, note: "Matches: name, business and categories", recheck: false, adminName: CHECKER.name });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d).toMatchObject({ stage: "passed", tab: "decided", checks: { card: "passed", register: "passed" } });
    expect(d.history[0]).toMatchObject({ kind: "register_passed", note: "Matches: name, business and categories" });
  });

  it("says what the register showed, and isn't due before the card check", async () => {
    const e = await live();
    expect((await call(registerCheck, { as: CHECKER, params: { engineerId: e.id }, body: {} })).status).toBe(400);
    const waiting = await withCard();
    expect((await call(registerCheck, { as: CHECKER, params: { engineerId: waiting.id }, body: { note: "Matches" } })).status).toBe(409);
  });

  it("can be asked for again, and passing it clears the request", async () => {
    const e = await checked();
    expect((await call(recheck, { as: CHECKER, params: { engineerId: e.id }, body: { reason: "Homeowner safety complaint" } })).status).toBe(200);
    expect((await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body).toMatchObject({ stage: "recheck", checks: { recheckRequested: { reason: "Homeowner safety complaint" } } });
    await call(registerCheck, { as: CHECKER, params: { engineerId: e.id }, body: { note: "Still on the register" } });
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeRecheckRequestedAt).toBeNull();
    expect((await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_register_checked" } })).meta).toMatchObject({ recheck: true });
  });

  it("can't be asked for again before it's passed once", async () => {
    const e = await live();
    expect((await call(recheck, { as: CHECKER, params: { engineerId: e.id }, body: { reason: "Complaint" } })).status).toBe(409);
  });
});

describe("suspending", () => {
  it("takes the badge down, tells the engineer why, and their customers when asked", async () => {
    const e = await live();
    const res = await call(suspend, { as: CHECKER, params: { engineerId: e.id }, body: { reason: "Not on the Gas Safe Register", tellCustomers: true } });
    expect(res.status).toBe(200);
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row).toMatchObject({ gasSafeVerifiedAt: null, gasSafeRejectReason: "Not on the Gas Safe Register" });
    expect(row.gasSafeSuspendedAt).not.toBeNull();
    expect(sent.email).toHaveBeenCalledWith(expect.objectContaining({ subject: "Your TradeSura account is suspended", html: expect.stringContaining("Not on the Gas Safe Register") }));
    expect(sent.offered).toHaveBeenCalledWith(e.id);
    expect(await prisma.event.findFirst({ where: { name: "engineer_customers_told" } })).toMatchObject({ meta: expect.objectContaining({ engineerId: e.id, offered: 2, why: "suspended" }) });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d).toMatchObject({ stage: "suspended", standing: "CHECK_FAILED", checks: { card: "passed", register: "suspended", suspended: { reason: "Not on the Gas Safe Register" } } });
  });

  it("leaves customers alone unless asked, and needs the engineer to be live", async () => {
    const e = await live();
    await call(suspend, { as: CHECKER, params: { engineerId: e.id }, body: { reason: "Not on the register" } });
    expect(sent.offered).not.toHaveBeenCalled();
    const waiting = await withCard();
    expect((await call(suspend, { as: CHECKER, params: { engineerId: waiting.id }, body: { reason: "Not on the register" } })).status).toBe(409);
  });

  it("puts a new card back in the card check, with the suspension shown, and passing it clears it", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: CARD, gasSafeSuspendedAt: new Date("2026-11-02"), gasSafeRejectReason: "Not on the register" });
    const d = (await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body;
    expect(d).toMatchObject({ stage: "card", checks: { card: "waiting", register: "suspended" } });
    expect(d.warnings.map((w: { code: string }) => w.code)).toContain("was_suspended");
    await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve", reason: "Renewed card, back on the register" } });
    const row = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.gasSafeSuspendedAt).toBeNull();
    expect((await call(detail, { as: CHECKER, params: { engineerId: e.id } })).body.stage).toBe("register");
  });
});

describe("claiming an application", () => {
  const other = { ...CHECKER, id: "adm_test_other", name: "Other Checker" };

  it("holds it for the admin checking it, and tells anyone else who has it", async () => {
    const e = await withCard();
    const mine = await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    expect(mine.body).toMatchObject({ claimed: true, lock: { holderId: CHECKER.id, holderName: CHECKER.name } });
    const theirs = await call(claim, { as: other, params: { engineerId: e.id }, method: "POST" });
    expect(theirs.body).toMatchObject({ claimed: false, lock: { holderName: CHECKER.name } });
    expect((await call(detail, { as: other, params: { engineerId: e.id } })).body.lock.holderName).toBe(CHECKER.name);
    expect((await call(list, { as: other })).body.items[0].claimedBy).toBe(CHECKER.name);
  });

  it("stops anyone else deciding it, and ends when it's decided", async () => {
    const e = await withCard();
    await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    const blocked = await call(decide, { as: other, params: { engineerId: e.id }, body: { decision: "approve" } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain(CHECKER.name);
    expect((await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "approve" } })).status).toBe(200);
    expect(await prisma.verificationClaim.count()).toBe(0);
  });

  it("runs out after 15 minutes", async () => {
    const e = await withCard();
    await prisma.verificationClaim.create({ data: { engineerId: e.id, adminId: CHECKER.id, adminName: CHECKER.name, claimedAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await call(claim, { as: other, params: { engineerId: e.id }, method: "POST" })).body.claimed).toBe(true);
  });

  it("records the start of a check once, not every refresh", async () => {
    const e = await withCard();
    await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" });
    expect(await prisma.event.count({ where: { name: "verification_claimed" } })).toBe(1);
  });

  it("isn't possible once it's decided", async () => {
    const e = await checked();
    expect((await call(claim, { as: CHECKER, params: { engineerId: e.id }, method: "POST" })).body).toEqual({ claimed: false, lock: null });
  });
});

describe("rejecting a duplicate", () => {
  it("records which account it duplicates", async () => {
    const existing = await checked();
    const e = await withCard();
    const res = await call(decide, { as: CHECKER, params: { engineerId: e.id }, body: { decision: "reject", reason: "Duplicate of an existing account", duplicateOf: existing.id } });
    expect(res.status).toBe(200);
    const event = await prisma.event.findFirstOrThrow({ where: { name: "gas_safe_rejected" } });
    expect(event.meta).toMatchObject({ engineerId: e.id, duplicateOf: existing.id });
  });

  it("needs the other account to exist", async () => {
    const e = await withCard();
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
