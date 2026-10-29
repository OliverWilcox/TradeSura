import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as engineerAccounts } from "@/app/api/admin/v1/accounts/engineers/route";
import { GET as customerAccounts } from "@/app/api/admin/v1/accounts/customers/route";
import { POST as remove } from "@/app/api/admin/v1/accounts/delete/route";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(resetDb);

const engineers = (query: Record<string, string> = {}) => call(engineerAccounts, { query });
const customers = (query: Record<string, string> = {}) => call(customerAccounts, { query });
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
const del = (body: { engineerIds?: string[]; customerIds?: string[]; reason?: string }) => call(remove, { body: { reason: "Tester asked to sign up again", ...body } });

describe("the engineer accounts list", () => {
  it("lists owners and staff newest first, with what deleting each would do, contact details masked", async () => {
    const owner = await makeEngineer({ email: "tester@example.test", phone: "+447700900111", stripeAccountId: "acct_1" });
    const staff = await makeEngineer({ ownerId: owner.id, phone: null, gasSafeNo: null });
    const onBook = await makeCustomer(owner.id);
    await makePlan(owner.id, onBook.id);
    await makePlan(owner.id, onBook.id, { status: "PENDING", activatedAt: null });
    await makeEngineer({ deletedAt: new Date() });

    const res = await engineers();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, size: 25, total: 2 });
    expect(ids(res)).toEqual([staff.id, owner.id]);
    expect(res.body.items[1]).toMatchObject({
      role: "owner",
      business: owner.tradingName,
      email: "t•••@example.test",
      phone: "•••• 111",
      staff: 1,
      customers: 1,
      plans: { live: 1, ending: 0, pending: 1 },
      stripeAccount: true,
      blocked: expect.stringContaining("live customer plan"),
    });
    expect(res.body.items[0]).toMatchObject({ role: "staff", business: owner.tradingName, ownerId: owner.id, blocked: null });
    expect(JSON.stringify(res.body)).not.toContain("tester@example.test");
  });

  it("searches names, or a whole email or mobile, several at once separated by commas", async () => {
    const a = await makeEngineer({ email: "tester@example.test", tradingName: "Hartley Boilers" });
    const b = await makeEngineer({ phone: "+447700900222" });
    await makeEngineer();
    expect(ids(await engineers({ q: "hartley" }))).toEqual([a.id]);
    expect(ids(await engineers({ q: "TESTER@example.test, 07700 900222", dir: "asc" }))).toEqual([a.id, b.id]);
    expect(ids(await engineers({ q: "tester@" }))).toEqual([]);
    expect(ids(await engineers({ q: "900222" }))).toEqual([]);
  });

  it("filters by role, status and whether they can be deleted now", async () => {
    const busy = await makeEngineer();
    await makePlan(busy.id, (await makeCustomer(busy.id)).id);
    const ending = await makeEngineer();
    await makePlan(ending.id, (await makeCustomer(ending.id)).id, { cancelRequestedAt: new Date() });
    const staff = await makeEngineer({ ownerId: busy.id, gasSafeNo: null });
    const paused = await makeEngineer({ pausedAt: new Date() });
    expect(ids(await engineers({ deletable: "no" }))).toEqual([busy.id]);
    expect(ids(await engineers({ deletable: "yes", dir: "asc" }))).toEqual([ending.id, staff.id, paused.id]);
    expect(ids(await engineers({ role: "staff" }))).toEqual([staff.id]);
    expect(ids(await engineers({ status: "paused" }))).toEqual([paused.id]);
    expect((await engineers({ deletable: "maybe" })).status).toBe(400);
  });

  it("needs data:delete", async () => {
    expect((await call(engineerAccounts, { as: CHECKER })).status).toBe(403);
    expect((await call(engineerAccounts, { as: withPermissions("engineers:read", "pii:reveal") })).status).toBe(403);
  });
});

describe("the customer accounts list", () => {
  it("lists customers with their engineer and what stops them being deleted, and searches and filters", async () => {
    const e = await makeEngineer();
    const free = await makeCustomer(e.id, { phone: "+447700900333", email: "jane@example.test" });
    const ending = await makeCustomer(e.id);
    await makePlan(e.id, ending.id, { cancelRequestedAt: new Date() });
    await makeCustomer((await makeEngineer({ deletedAt: new Date() })).id);

    const res = await customers({ dir: "asc" });
    expect(res.body.total).toBe(2);
    expect(res.body.items[0]).toMatchObject({ id: free.id, engineer: { id: e.id, business: e.tradingName }, phone: "•••• 333", email: "j•••@example.test", blocked: null });
    expect(res.body.items[1]).toMatchObject({ id: ending.id, plans: { live: 0, ending: 1, pending: 0 }, blocked: expect.stringContaining("hasn't ended") });
    expect(ids(await customers({ q: "07700 900333, nobody@example.test" }))).toEqual([free.id]);
    expect(ids(await customers({ deletable: "yes" }))).toEqual([free.id]);
    expect(ids(await customers({ deletable: "no" }))).toEqual([ending.id]);
    expect((await call(customerAccounts, { as: CHECKER })).status).toBe(403);
  });
});

describe("deleting accounts", () => {
  it("deletes an owner so the same email, mobile, Gas Safe number and Apple ID can sign up again", async () => {
    const owner = await makeEngineer({ email: "tester@example.test", phone: "+447700900111", gasSafeNo: "555111", appleSub: "apple.tester" });
    const staff = await makeEngineer({ ownerId: owner.id, gasSafeNo: null });
    const customer = await makeCustomer(owner.id);
    await prisma.property.create({ data: { customerId: customer.id, addressLine1: "1 Test Street", postcode: "LS1 1AA" } });
    const offer = await makePlan(owner.id, customer.id, { status: "PENDING", activatedAt: null });
    await prisma.adminNote.create({ data: { subjectType: "engineer", subjectId: owner.id, body: "Tester", authorId: "adm", authorName: "Admin" } });

    // Staff and customers first in the request: still reported as deleted with the business.
    const res = await del({ engineerIds: [staff.id, owner.id], customerIds: [customer.id] });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      { type: "engineer", id: owner.id, name: owner.tradingName, outcome: "deleted", message: "Deleted, with 1 staff account and 1 customer." },
      { type: "engineer", id: staff.id, name: `${staff.firstName} ${staff.lastName}`, outcome: "deleted", message: `Deleted with ${owner.tradingName}.` },
      { type: "customer", id: customer.id, name: `${customer.firstName} ${customer.lastName}`, outcome: "deleted", message: `Deleted with ${owner.tradingName}.` },
    ]);

    const gone = await prisma.engineer.findUniqueOrThrow({ where: { id: owner.id } });
    expect(gone).toMatchObject({ phone: null, gasSafeNo: null, appleSub: null, firstName: null });
    expect(gone.deletedAt).not.toBeNull();
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: staff.id } })).deletedAt).not.toBeNull();
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).toMatchObject({ firstName: "Deleted", email: null, phone: `deleted-${customer.id}` });
    expect(await prisma.property.count()).toBe(0);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("CANCELLED");
    expect(await prisma.adminNote.count({ where: { deletedAt: null } })).toBe(0);

    // The same details sign up again.
    await expect(makeEngineer({ email: "tester@example.test", phone: "+447700900111", gasSafeNo: "555111", appleSub: "apple.tester" })).resolves.toBeTruthy();

    const event = await prisma.event.findFirstOrThrow({ where: { name: "admin_account_deleted", actorType: "ADMIN" } });
    expect(event.meta).toMatchObject({ engineerId: owner.id, role: "owner", reason: "Tester asked to sign up again", staffDeleted: 1, customersRemoved: 1, via: "admin_api" });
  });

  it("refuses an owner with a live customer plan, and carries on with the rest", async () => {
    const busy = await makeEngineer();
    await makePlan(busy.id, (await makeCustomer(busy.id)).id);
    const ending = await makeEngineer();
    await makePlan(ending.id, (await makeCustomer(ending.id)).id, { cancelRequestedAt: new Date() });

    const res = await del({ engineerIds: [busy.id, ending.id] });
    expect(res.body.items.map((i: { outcome: string }) => i.outcome)).toEqual(["refused", "deleted"]);
    expect(res.body.items[0].message).toContain("live customer plan");
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: busy.id } })).deletedAt).toBeNull();
  });

  it("deletes a staff member on their own, leaving the business", async () => {
    const owner = await makeEngineer();
    const staff = await makeEngineer({ ownerId: owner.id, gasSafeNo: null });
    const res = await del({ engineerIds: [staff.id] });
    expect(res.body.items[0]).toMatchObject({ outcome: "deleted", message: `Deleted, and taken off the team at ${owner.tradingName}.` });
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: owner.id } })).deletedAt).toBeNull();
  });

  it("deletes a customer: homes removed, details scrubbed, offers withdrawn, plan history kept", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id);
    const home = await prisma.property.create({ data: { customerId: c.id, addressLine1: "2 Test Street", postcode: "LS1 1AA" } });
    await prisma.appliance.create({ data: { propertyId: home.id, make: "Worcester" } });
    const old = await makePlan(e.id, c.id, { status: "CANCELLED", cancelledAt: new Date() });
    const offer = await makePlan(e.id, c.id, { status: "PENDING", activatedAt: null });
    await prisma.outboundSms.create({ data: { engineerId: e.id, toPhone: c.phone, senderName: "Test", body: "Reminder", class: "TRANSACTIONAL", sendAfter: new Date(Date.now() + 86_400_000), cancelKey: `nudge:${offer.id}` } });

    const res = await del({ customerIds: [c.id] });
    expect(res.body.items[0]).toMatchObject({ type: "customer", outcome: "deleted", message: "Deleted, and 1 offer withdrawn." });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ firstName: "Deleted", lastName: "customer", email: null });
    expect(await prisma.property.count()).toBe(0);
    expect(await prisma.appliance.count()).toBe(0);
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("CANCELLED");
    expect((await prisma.plan.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("CANCELLED");
    expect((await prisma.outboundSms.findFirstOrThrow()).status).toBe("CANCELLED");
    // The engineer can add the same number again.
    await expect(makeCustomer(e.id, { phone: c.phone })).resolves.toBeTruthy();
    expect(await prisma.event.count({ where: { name: "admin_customer_deleted", actorType: "ADMIN" } })).toBe(1);
  });

  it("refuses a customer whose plan hasn't ended, even one running out its paid month", async () => {
    const e = await makeEngineer();
    const live = await makeCustomer(e.id);
    await makePlan(e.id, live.id);
    const ending = await makeCustomer(e.id);
    await makePlan(e.id, ending.id, { cancelRequestedAt: new Date() });
    const res = await del({ customerIds: [live.id, ending.id] });
    expect(res.body.items.map((i: { outcome: string }) => i.outcome)).toEqual(["refused", "refused"]);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: live.id } })).firstName).toBe("Jane");
  });

  it("says when an account was already deleted or never existed", async () => {
    const e = await makeEngineer({ deletedAt: new Date() });
    const res = await del({ engineerIds: [e.id, "cl_nothing"], customerIds: ["cl_nobody"] });
    expect(res.body.items.map((i: { outcome: string }) => i.outcome)).toEqual(["gone", "gone", "gone"]);
  });

  it("takes an optional reason; needs something to delete, and data:delete", async () => {
    const e = await makeEngineer();
    expect((await call(remove, { body: { engineerIds: [e.id], reason: "x".repeat(501) } })).status).toBe(400);
    expect((await call(remove, { body: { engineerIds: [e.id] } })).body.items[0].outcome).toBe("deleted");
    const event = await prisma.event.findFirstOrThrow({ where: { name: "admin_account_deleted" } });
    expect(event.meta).not.toHaveProperty("reason");
    const other = await makeEngineer();
    expect((await del({})).status).toBe(400);
    expect((await call(remove, { as: CHECKER, body: { engineerIds: [other.id] } })).status).toBe(403);
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: other.id } })).deletedAt).toBeNull();
  });
});
