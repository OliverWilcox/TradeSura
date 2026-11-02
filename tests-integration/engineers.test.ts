import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/engineers/route";
import { GET as filterOptions } from "@/app/api/admin/v1/engineers/filter-options/route";
import { GET as detail } from "@/app/api/admin/v1/engineers/[engineerId]/route";
import { GET as activity } from "@/app/api/admin/v1/engineers/[engineerId]/activity/route";
import { POST as reveal } from "@/app/api/admin/v1/engineers/[engineerId]/contact/route";
import { POST as pause } from "@/app/api/admin/v1/engineers/[engineerId]/pause/route";
import { POST as resume } from "@/app/api/admin/v1/engineers/[engineerId]/resume/route";
import { POST as ban } from "@/app/api/admin/v1/engineers/[engineerId]/ban/route";
import { POST as unban } from "@/app/api/admin/v1/engineers/[engineerId]/unban/route";
import { POST as widget } from "@/app/api/admin/v1/engineers/[engineerId]/widget/route";
import { GET as notes, POST as addNote } from "@/app/api/admin/v1/engineers/[engineerId]/notes/route";
import { DELETE as deleteNote } from "@/app/api/admin/v1/engineers/[engineerId]/notes/[noteId]/route";
import { call, CHECKER, resetDb, SUPER_ADMIN, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(resetDb);

const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe("the engineer list", () => {
  it("leaves out deleted accounts and counts live plans and customers", async () => {
    const e = await makeEngineer();
    await makeEngineer({ deletedAt: new Date() });
    const c1 = await makeCustomer(e.id);
    const c2 = await makeCustomer(e.id);
    await makePlan(e.id, c1.id);
    await makePlan(e.id, c2.id, { status: "CANCELLED" });
    const res = await call(list);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    // No offer sent, so not active, though the account is in good standing.
    expect(res.body.items[0]).toMatchObject({ id: e.id, plansLive: 1, customers: 2, status: "inactive", isTest: false, verification: "pending" });
    expect(res.body.items[0].lastOfferAt).not.toBeNull();
  });

  it("filters by status, verification and team", async () => {
    const paused = await makeEngineer({ pausedAt: new Date() });
    const banned = await makeEngineer({ bannedAt: new Date(), pausedAt: new Date() });
    const verified = await makeEngineer({ gasSafeVerifiedAt: new Date() });
    const staff = await makeEngineer({ ownerId: verified.id, gasSafeNo: null });
    expect(ids(await call(list, { query: { status: "paused" } }))).toEqual([paused.id]);
    expect(ids(await call(list, { query: { status: "banned" } }))).toEqual([banned.id]);
    expect(ids(await call(list, { query: { verification: "verified" } }))).toEqual([verified.id]);
    expect(ids(await call(list, { query: { staff: "staff" } }))).toEqual([staff.id]);
  });

  it("finds an engineer by business name, Gas Safe number or phone", async () => {
    const e = await makeEngineer({ tradingName: "Hartley Boilers", gasSafeNo: "584123", phone: "+447700900555" });
    await makeEngineer();
    expect(ids(await call(list, { query: { q: "hartley" } }))).toEqual([e.id]);
    expect(ids(await call(list, { query: { q: "584123" } }))).toEqual([e.id]);
    expect(ids(await call(list, { query: { q: "07700 900555" } }))).toEqual([e.id]);
    expect(ids(await call(list, { query: { q: "900555" } }))).toEqual([]);
    expect(ids(await call(list, { query: { q: e.email.toUpperCase() } }))).toEqual([e.id]);
    expect(ids(await call(list, { query: { q: e.email.split("@")[0] + "@" } }))).toEqual([]);
  });

  it("filters by how far through getting started they are, and by town", async () => {
    const verifiedAt = new Date("2026-10-01");
    const justJoined = await makeEngineer({ town: "Leeds", stripeChargesEnabled: true }); // payments set up, but not verified: still at the first step
    const verified = await makeEngineer({ gasSafeVerifiedAt: verifiedAt, town: "Huddersfield" });
    const planLive = await makeEngineer({ gasSafeVerifiedAt: verifiedAt });
    await prisma.planTier.create({ data: { engineerId: planLive.id, name: "Care", priceMonthlyPence: 1500, sortOrder: 0, status: "LIVE" } });
    const paid = await makeEngineer({ gasSafeVerifiedAt: verifiedAt, stripeChargesEnabled: true });
    await prisma.planTier.create({ data: { engineerId: paid.id, name: "Care", priceMonthlyPence: 1500, sortOrder: 0, status: "LIVE" } });
    await makePlan(paid.id, (await makeCustomer(paid.id)).id, { stripeSubscriptionId: "sub_paid" });
    await prisma.stripeWebhookEvent.create({ data: { id: "evt_paid", type: "invoice.paid", payload: { data: { object: { id: "in_paid", amount_paid: 1500, subscription: "sub_paid" } } } } });
    expect(ids(await call(list, { query: { step: "signed_up" } }))).toEqual([justJoined.id]);
    expect(ids(await call(list, { query: { step: "verified" } }))).toEqual([verified.id]);
    expect(ids(await call(list, { query: { step: "plan_live" } }))).toEqual([planLive.id]);
    expect(ids(await call(list, { query: { step: "first_payment" } }))).toEqual([paid.id]);
    expect(ids(await call(list, { query: { town: "leeds" } }))).toEqual([justJoined.id]);
    const options = await call(filterOptions);
    expect(options.body.towns).toEqual(["Huddersfield", "Leeds"]);
  });

  it("refuses filters it doesn't know", async () => {
    const res = await call(list, { query: { status: "deleted" } });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.status).toBeDefined();
  });

  it("is closed to verification checkers", async () => {
    expect((await call(list, { as: CHECKER })).status).toBe(403);
  });
});

describe("one engineer", () => {
  it("shows their business, money and standing, with contact details masked", async () => {
    const e = await makeEngineer({ email: "dave@hartley.example", phone: "+447700900123", stripeAccountId: "acct_1", stripeChargesEnabled: true, stripeDetailsSubmitted: true });
    const c = await makeCustomer(e.id);
    await makePlan(e.id, c.id, { priceMonthlyPence: 2000 });
    await prisma.planTier.create({ data: { engineerId: e.id, name: "Boiler care", priceMonthlyPence: 2000, sortOrder: 0, status: "LIVE" } });
    const res = await call(detail, { params: { engineerId: e.id } });
    expect(res.status).toBe(200);
    expect(res.body.contact).toEqual({ email: "d•••@hartley.example", phone: "•••• 123", revealed: false, phoneVerifiedAt: null, setupTextConsentAt: null, marketingConsent: false });
    expect(res.body.money).toEqual({ monthlyPlanValuePence: 2000, tradesuraFeePence: 400 });
    expect(res.body.activation).toMatchObject({ paymentsReady: true, planLive: true, firstCustomer: true });
    expect(res.body.counts.plans).toEqual({ ACTIVE: 1, PENDING: 0, PAUSED: 0, CANCELLED: 0 });
    expect(JSON.stringify(res.body)).not.toContain("dave@hartley.example");
  });

  it("shows their plans, referrals, payouts and milestones", async () => {
    const e = await makeEngineer({ stripeAccountId: "acct_hartley", stripeChargesEnabled: true });
    const clause = await prisma.clauseTemplate.create({ data: { code: "ANNUAL_SERVICE_T", title: "Annual boiler service", bodyText: "x", kind: "CORE", sortOrder: 0 } });
    const tier = await prisma.planTier.create({ data: { engineerId: e.id, name: "Boiler care", priceMonthlyPence: 1500, sortOrder: 0, status: "LIVE", clauses: { create: { clauseId: clause.id } } } });
    const invitee = await makeEngineer({ referrerId: e.id, tradingName: "Invited Heating" });
    await prisma.referralEarning.createMany({
      data: [
        { referrerId: e.id, inviteeId: invitee.id, invoiceId: "in_1", feePence: 300, ratePercent: 25, amountPence: 75, transferId: "tr_1" },
        { referrerId: e.id, inviteeId: invitee.id, invoiceId: "in_2", feePence: 300, ratePercent: 25, amountPence: 75 },
      ],
    });
    await prisma.stripeWebhookEvent.create({
      data: { id: "evt_po_1", type: "payout.paid", payload: { account: "acct_hartley", data: { object: { id: "po_1", amount: 4321, arrival_date: 1792800000 } } } },
    });
    await prisma.event.create({ data: { name: "plan_live", actorType: "ENGINEER", actorId: e.id, ts: new Date("2026-10-03T09:00:00Z"), meta: { tierId: tier.id } } });

    const res = await call(detail, { params: { engineerId: e.id } });
    expect(res.body.tiers).toEqual([{ id: tier.id, name: "Boiler care", status: "LIVE", priceMonthlyPence: 1500, options: ["Annual boiler service"], customersOnIt: 0 }]);
    expect(res.body.referrals).toMatchObject({ code: e.slug, earnedPence: 150, paidPence: 75, owedPence: 75, people: [{ id: invitee.id, business: "Invited Heating", earnedPence: 150, currentRatePercent: 25 }] });
    expect(res.body.payouts).toEqual([{ id: "po_1", paidOn: "2026-10-24", amountPence: 4321, status: "paid" }]);
    expect(res.body.lifetimePayoutsPence).toBe(4321);
    expect(res.body.steps.find((s: { key: string }) => s.key === "plan_live")).toEqual({ key: "plan_live", label: "First plan live", reached: true, at: "2026-10-03T09:00:00.000Z" });
  });

  // 4.2: Activation and the Payments panel both read the Stripe account.
  it("says payments are set up when Stripe says the account can take them, event or not", async () => {
    const e = await makeEngineer({ stripeAccountId: "acct_1", stripeChargesEnabled: true, stripePayoutsEnabled: true });
    const res = await call(detail, { params: { engineerId: e.id } });
    expect(res.body.payments).toMatchObject({ chargesEnabled: true, payoutsEnabled: true });
    expect(res.body.steps.find((s: { key: string }) => s.key === "payments_set_up")).toMatchObject({ reached: true });
    expect(res.body.activation.paymentsReady).toBe(true);
  });

  // 2.2: one definition of active, in the list, on the record and on the dashboard.
  it("is active only with a delivered offer in the last 7 days", async () => {
    const recent = await makeEngineer();
    const whatsappOnly = await makeEngineer();
    const old = await makeEngineer();
    const offer = async (engineerId: string, channel: string, daysAgo: number) => {
      const c = await makeCustomer(engineerId);
      const plan = await makePlan(engineerId, c.id, { status: "PENDING", activatedAt: null });
      await prisma.event.create({ data: { name: "offer_sent", actorType: "ENGINEER", actorId: engineerId, ts: new Date(Date.now() - daysAgo * 86_400_000), meta: { planId: plan.id, channel } } });
    };
    await offer(recent.id, "sms", 2);
    await offer(whatsappOnly.id, "whatsapp", 1); // never opened: not confirmed
    await offer(old.id, "sms", 9);
    const status = Object.fromEntries((await call(list)).body.items.map((i: { id: string; status: string }) => [i.id, i.status]));
    expect(status).toEqual({ [recent.id]: "active", [whatsappOnly.id]: "inactive", [old.id]: "inactive" });
    expect(ids(await call(list, { query: { status: "active" } }))).toEqual([recent.id]);
    expect((await call(detail, { params: { engineerId: old.id } })).body.status).toBe("inactive");
  });

  it("shows each address on its own, and why customers cancelled", async () => {
    const e = await makeEngineer({ serviceArea: "Holmfirth, Huddersfield, HD9", postcode: "E16 1YL", packAddress: "Unit 2\nHolmfirth\nHD9 2TT", town: "Huddersfield" });
    for (const reason of ["moving", "moving", "too_expensive"]) {
      const plan = await makePlan(e.id, (await makeCustomer(e.id)).id, { status: "CANCELLED", cancelledAt: new Date() });
      await prisma.cancelRequest.create({ data: { planId: plan.id, engineerId: e.id, reason, outcome: "cancelled" } });
    }
    const res = await call(detail, { params: { engineerId: e.id } });
    expect(res.body.addresses).toEqual({
      areasCovered: ["Holmfirth", "Huddersfield", "HD9"],
      signupPostcode: "E16 1YL",
      postal: "Unit 2\nHolmfirth\nHD9 2TT",
      registeredOffice: null,
      // Read from the pack address until it's saved as the trading address.
      trading: { lines: ["Unit 2"], town: "Holmfirth", postcode: "HD9 2TT", source: null, updatedAt: null, updatedBy: null },
      correspondence: { address: "Unit 2\nHolmfirth\nHD9 2TT", sameAsTrading: true },
      tradingIsRegisteredOffice: false,
    });
    expect(res.body.cancelReasons).toEqual([{ reason: "moving", count: 2 }, { reason: "too_expensive", count: 1 }]);
  });

  it("reveals contact details only with permission, and records it", async () => {
    const e = await makeEngineer({ email: "dave@hartley.example" });
    expect((await call(reveal, { as: withPermissions("engineers:read"), params: { engineerId: e.id } })).status).toBe(403);
    const res = await call(reveal, { params: { engineerId: e.id } });
    expect(res.body).toEqual({ email: "dave@hartley.example", phone: e.phone });
    const event = await prisma.event.findFirstOrThrow({ where: { name: "admin_contact_revealed" } });
    expect(event).toMatchObject({ actorType: "ADMIN", actorId: SUPER_ADMIN.id });
  });

  it("is a 404 for a deleted account", async () => {
    const e = await makeEngineer({ deletedAt: new Date() });
    expect((await call(detail, { params: { engineerId: e.id } })).status).toBe(404);
  });
});

describe("an engineer's standing", () => {
  it("can be paused with a reason, and resumed", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date() });
    const paused = await call(pause, { params: { engineerId: e.id }, body: { reason: "Customer complaints under review" } });
    expect(paused.status).toBe(200);
    expect(paused.body).toMatchObject({ status: "paused", standing: "PAUSED", pause: { reason: "Customer complaints under review" } });
    expect((await call(pause, { params: { engineerId: e.id }, body: { reason: "Again" } })).status).toBe(409);

    const resumed = await call(resume, { params: { engineerId: e.id }, body: {} });
    expect(resumed.body).toMatchObject({ status: "inactive", standing: "ACTIVE", pause: null });
    const names = (await prisma.event.findMany({ where: { actorType: "ADMIN" }, orderBy: { ts: "asc" } })).map((ev) => ev.name);
    expect(names).toEqual(["engineer_paused", "engineer_resumed"]);
  });

  it("needs a reason to pause or ban", async () => {
    const e = await makeEngineer();
    expect((await call(pause, { params: { engineerId: e.id }, body: {} })).status).toBe(400);
    expect((await call(ban, { params: { engineerId: e.id }, body: { reason: "x" } })).status).toBe(400);
  });

  it("can be banned and unbanned by someone allowed to ban", async () => {
    const e = await makeEngineer();
    const statusOnly = withPermissions("engineers:read", "engineers:status");
    expect((await call(ban, { as: statusOnly, params: { engineerId: e.id }, body: { reason: "Fraudulent sign-ups" } })).status).toBe(403);
    const banned = await call(ban, { params: { engineerId: e.id }, body: { reason: "Fraudulent sign-ups" } });
    expect(banned.body).toMatchObject({ status: "banned", standing: "BANNED", ban: { reason: "Fraudulent sign-ups" } });
    const unbanned = await call(unban, { params: { engineerId: e.id }, body: { reason: "Appeal upheld" } });
    expect(unbanned.body.status).toBe("inactive"); // back in good standing; no offers sent
  });

  it("can have the website widget switched off and on", async () => {
    const e = await makeEngineer({ websiteConnectedAt: new Date(), websiteHost: "hartley.example" });
    const off = await call(widget, { params: { engineerId: e.id }, body: { disabled: true, reason: "Widget on an unrelated site" } });
    expect(off.body.website.widgetDisabledAt).not.toBeNull();
    expect((await call(widget, { params: { engineerId: e.id }, body: { disabled: true } })).status).toBe(409);
    const on = await call(widget, { params: { engineerId: e.id }, body: { disabled: false } });
    expect(on.body.website.widgetDisabledAt).toBeNull();
  });

  it("shows up in the engineer's activity, with who did it and why", async () => {
    const e = await makeEngineer();
    await call(pause, { params: { engineerId: e.id }, body: { reason: "Checking a complaint" } });
    const res = await call(activity, { params: { engineerId: e.id } });
    expect(res.body.items[0]).toMatchObject({ name: "engineer_paused", actor: { type: "ADMIN", name: SUPER_ADMIN.name }, reason: "Checking a complaint" });
  });
});

describe("notes on an engineer", () => {
  it("can be added, listed newest first and removed", async () => {
    const e = await makeEngineer();
    const first = await call(addNote, { params: { engineerId: e.id }, body: { body: "Called about the Stripe hold" } });
    expect(first.status).toBe(200);
    await call(addNote, { params: { engineerId: e.id }, body: { body: "Sent the replacement stickers" } });
    const listed = await call(notes, { params: { engineerId: e.id } });
    expect(listed.body.items.map((n: { body: string }) => n.body)).toEqual(["Sent the replacement stickers", "Called about the Stripe hold"]);
    expect(listed.body.items[0].authorName).toBe(SUPER_ADMIN.name);

    expect((await call(deleteNote, { method: "DELETE", params: { engineerId: e.id, noteId: first.body.id } })).status).toBe(200);
    expect((await call(notes, { params: { engineerId: e.id } })).body.items).toHaveLength(1);
    expect((await call(deleteNote, { method: "DELETE", params: { engineerId: e.id, noteId: first.body.id } })).status).toBe(404);
  });

  it("keep the note text out of the audit event", async () => {
    const e = await makeEngineer();
    await call(addNote, { params: { engineerId: e.id }, body: { body: "Private remark" } });
    const event = await prisma.event.findFirstOrThrow({ where: { name: "admin_note_added" } });
    expect(JSON.stringify(event.meta)).not.toContain("Private remark");
  });

  it("can't be empty", async () => {
    const e = await makeEngineer();
    expect((await call(addNote, { params: { engineerId: e.id }, body: { body: "   " } })).status).toBe(400);
  });
});
