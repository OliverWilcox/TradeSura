import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list } from "@/app/api/admin/v1/customers/route";
import { GET as detail } from "@/app/api/admin/v1/customers/[customerId]/route";
import { POST as reveal } from "@/app/api/admin/v1/customers/[customerId]/contact/route";
import { GET as notes, POST as addNote } from "@/app/api/admin/v1/customers/[customerId]/notes/route";
import { call, CHECKER, resetDb, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(resetDb);

const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);

describe("the customer list", () => {
  it("shows each customer's current plan, with contact details masked", async () => {
    const e = await makeEngineer({ tradingName: "Hartley Heating" });
    const c = await makeCustomer(e.id, { phone: "+447700901234", email: "jane@home.example" });
    await makePlan(e.id, c.id, { status: "CANCELLED", createdAt: new Date("2026-09-01") });
    const live = await makePlan(e.id, c.id, { status: "ACTIVE", priceMonthlyPence: 1800 });
    const res = await call(list);
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({
      id: c.id,
      engineer: { id: e.id, business: "Hartley Heating" },
      contact: { phone: "•••• 234", email: "j•••@home.example" },
      plan: { id: live.id, status: "ACTIVE", priceMonthlyPence: 1800 },
    });
    expect(JSON.stringify(res.body)).not.toContain("jane@home.example");
  });

  it("filters by plan status and engineer", async () => {
    const a = await makeEngineer();
    const b = await makeEngineer();
    const onPlan = await makeCustomer(a.id);
    await makePlan(a.id, onPlan.id);
    const noPlan = await makeCustomer(a.id);
    const otherBook = await makeCustomer(b.id);
    expect(ids(await call(list, { query: { plan: "active" } }))).toEqual([onPlan.id]);
    expect(ids(await call(list, { query: { plan: "none", sort: "added", dir: "asc" } }))).toEqual([noPlan.id, otherBook.id]);
    expect(ids(await call(list, { query: { engineerId: b.id } }))).toEqual([otherBook.id]);
  });

  it("finds a customer by postcode, plan reference or phone", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id, { phone: "+447700905555", properties: { create: { addressLine1: "4 Mill Lane", postcode: "HD1 2AB" } } });
    const plan = await makePlan(e.id, c.id, { ref: "TS-7Q2K" });
    await makeCustomer(e.id);
    expect(ids(await call(list, { query: { q: "hd1 2ab" } }))).toEqual([c.id]);
    expect(ids(await call(list, { query: { q: plan.ref.toLowerCase() } }))).toEqual([c.id]);
    expect(ids(await call(list, { query: { q: "07700 905555" } }))).toEqual([c.id]);
    expect(ids(await call(list, { query: { q: c.email! } }))).toEqual([c.id]);
  });

  it("matches phone numbers and emails only whole, so masked details can't be pieced together", async () => {
    const e = await makeEngineer();
    await makeCustomer(e.id, { phone: "+447700905555", email: "jane@home.example" });
    expect(ids(await call(list, { query: { q: "905555" } }))).toEqual([]);
    expect(ids(await call(list, { query: { q: "jane@" } }))).toEqual([]);
    expect(ids(await call(list, { query: { q: "home.example" } }))).toEqual([]);
  });

  it("leaves out customers of deleted engineer accounts", async () => {
    const gone = await makeEngineer({ deletedAt: new Date() });
    await makeCustomer(gone.id);
    expect((await call(list)).body.total).toBe(0);
  });

  it("is closed to verification checkers", async () => {
    expect((await call(list, { as: CHECKER })).status).toBe(403);
  });
});

describe("one customer", () => {
  it("shows their homes, plans and cancellations", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id, {
      properties: { create: { addressLine1: "4 Mill Lane", town: "Huddersfield", postcode: "HD1 2AB", appliances: { create: { make: "Worcester", model: "30i", type: "boiler" } } } },
    });
    const plan = await makePlan(e.id, c.id, { cancelRequestedAt: new Date("2026-10-10") });
    await prisma.cancelRequest.create({ data: { planId: plan.id, engineerId: e.id, reason: "moving", outcome: "pending" } });
    const res = await call(detail, { params: { customerId: c.id } });
    expect(res.status).toBe(200);
    expect(res.body.homes[0]).toMatchObject({ addressLine1: "4 Mill Lane", postcode: "HD1 2AB", appliances: [expect.objectContaining({ make: "Worcester" })] });
    expect(res.body.plans[0]).toMatchObject({ ref: plan.ref, status: "ACTIVE", cancelRequestedAt: "2026-10-10T00:00:00.000Z", cancellations: [expect.objectContaining({ reason: "moving" })] });
  });

  it("reveals contact details only with permission, and records it", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id, { phone: "+447700901234" });
    expect((await call(reveal, { as: withPermissions("customers:read"), params: { customerId: c.id } })).status).toBe(403);
    expect((await call(reveal, { params: { customerId: c.id } })).body.phone).toBe("+447700901234");
    expect(await prisma.event.count({ where: { name: "admin_contact_revealed", actorType: "ADMIN" } })).toBe(1);
  });

  it("can have notes", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id);
    await call(addNote, { params: { customerId: c.id }, body: { body: "Wants a call before the service" } });
    expect((await call(notes, { params: { customerId: c.id } })).body.items).toHaveLength(1);
    expect((await call(addNote, { as: withPermissions("customers:read"), params: { customerId: c.id }, body: { body: "x" } })).status).toBe(403);
  });

  it("is a 404 when there's no such customer", async () => {
    expect((await call(detail, { params: { customerId: "nope" } })).status).toBe(404);
  });
});

describe("a customer's payments", () => {
  const invoice = (id: string, type: string, sub: string, amount: number, paidAt: string | null) => ({
    id: `evt_${id}`,
    type,
    payload: {
      data: {
        object: {
          id,
          ...(type === "invoice.paid" ? { amount_paid: amount, application_fee_amount: Math.floor(amount * 0.2) } : { amount_due: amount }),
          status_transitions: { paid_at: paidAt ? Math.floor(new Date(paidAt).getTime() / 1000) : null },
          parent: { subscription_details: { subscription: sub } },
        },
      },
    },
  });

  it("come from the Stripe invoice events for their plans' subscriptions", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id);
    await makePlan(e.id, c.id, { stripeSubscriptionId: "sub_mine" });
    await prisma.stripeWebhookEvent.createMany({
      data: [
        invoice("in_1", "invoice.paid", "sub_mine", 1500, "2026-09-05T10:00:00Z"),
        invoice("in_2", "invoice.payment_failed", "sub_mine", 1500, null),
        invoice("in_3", "invoice.paid", "sub_someone_else", 9999, "2026-09-05T10:00:00Z"),
      ],
    });
    const res = await call(detail, { params: { customerId: c.id } });
    expect(res.body.payments).toHaveLength(2);
    expect(res.body.payments.find((p: { id: string }) => p.id === "in_1")).toMatchObject({ status: "paid", amountPence: 1500, feePence: 300, at: "2026-09-05T10:00:00.000Z" });
    expect(res.body.payments.find((p: { id: string }) => p.id === "in_2")).toMatchObject({ status: "failed", amountPence: 1500 });
  });

  it("can be filtered on: failing, or cancelled in a date range", async () => {
    const e = await makeEngineer();
    const failing = await makeCustomer(e.id);
    await makePlan(e.id, failing.id, { paymentFailedAt: new Date("2026-10-10") });
    const recovered = await makeCustomer(e.id);
    await makePlan(e.id, recovered.id, { paymentFailedAt: new Date("2026-10-10"), paymentRecoveredAt: new Date("2026-10-12") });
    const left = await makeCustomer(e.id);
    await makePlan(e.id, left.id, { status: "CANCELLED", cancelledAt: new Date("2026-10-03T12:00:00Z") });
    expect(ids(await call(list, { query: { payment: "failing" } }))).toEqual([failing.id]);
    expect(ids(await call(list, { query: { cancelledFrom: "2026-10-01", cancelledTo: "2026-10-05" } }))).toEqual([left.id]);
  });
});
