// Matt, 30 Oct §9.6 — reversed Direct Debit payments and disputes come out of
// the installer's balance: their share of the collection is reversed back,
// and handed back if the claim is overturned.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const m = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  stripe: {
    charges: { retrieve: vi.fn() },
    invoicePayments: { list: vi.fn() },
    invoices: { retrieve: vi.fn() },
    transfers: { retrieve: vi.fn(), createReversal: vi.fn(), create: vi.fn() },
  },
  notify: vi.fn(async () => true),
  push: vi.fn(async () => {}),
  email: vi.fn(async () => {}),
  track: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    planDispute: {
      findUnique: vi.fn(async ({ where }: { where: { stripeDisputeId: string } }) => m.rows.get(where.stripeDisputeId) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "pd1", closedAt: null, ...data };
        m.rows.set(data.stripeDisputeId as string, row);
        return row;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = [...m.rows.values()][0];
        Object.assign(row, data);
        return row;
      }),
    },
    plan: { findFirst: vi.fn(async () => ({ id: "p1", ref: "TSH-1", engineerId: "e1", customer: { firstName: "Sam", lastName: "Hill" } })) },
    engineer: { findUnique: vi.fn(async () => ({ stripeAccountId: "acct_e1" })) },
  },
}));
vi.mock("@/lib/stripe", () => ({ getStripe: () => m.stripe }));
vi.mock("@/lib/track", () => ({ track: m.track }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: m.notify }));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));

import { handleDisputeClosed, handleDisputeCreated } from "@/lib/disputes";

const dispute = (over: Partial<Stripe.Dispute> = {}) =>
  ({ id: "dp_1", charge: "ch_1", amount: 1300, currency: "gbp", reason: "debit_not_authorized", status: "needs_response", ...over }) as Stripe.Dispute;

beforeEach(() => {
  m.rows.clear();
  vi.clearAllMocks();
  m.stripe.charges.retrieve.mockResolvedValue({ id: "ch_1", payment_intent: "pi_1", transfer: "tr_1" });
  m.stripe.invoicePayments.list.mockResolvedValue({ data: [{ invoice: "in_1" }] });
  m.stripe.invoices.retrieve.mockResolvedValue({ parent: { subscription_details: { subscription: "sub_1" } } });
  // A destination charge transfers the whole £13; our fee comes back as the application fee.
  m.stripe.transfers.retrieve.mockResolvedValue({ id: "tr_1", amount: 1300, amount_reversed: 0, destination: "acct_e1" });
  m.stripe.transfers.createReversal.mockResolvedValue({ id: "trr_1" });
  m.stripe.transfers.create.mockResolvedValue({ id: "tr_back" });
});

describe("a payment claimed back", () => {
  it("reverses the engineer's share of that collection, records it and tells them", async () => {
    await handleDisputeCreated(dispute());
    expect(m.stripe.transfers.createReversal).toHaveBeenCalledWith("tr_1", expect.objectContaining({ amount: 1300 }), { idempotencyKey: "dispute-reverse:dp_1" });
    expect(m.rows.get("dp_1")).toMatchObject({ planId: "p1", engineerId: "e1", amountPence: 1300, reversedPence: 1300, reversalId: "trr_1" });
    expect(m.track).toHaveBeenCalledWith("payment_disputed", expect.anything(), expect.objectContaining({ planId: "p1", reversedPence: 1300 }));
    expect(m.notify).toHaveBeenCalledWith("e1", expect.stringContaining("Sam Hill has claimed back a £13 Direct Debit payment"));
    expect(m.email).toHaveBeenCalledTimes(1);
  });

  it("never reverses more than is left on the transfer", async () => {
    m.stripe.transfers.retrieve.mockResolvedValue({ id: "tr_1", amount: 1300, amount_reversed: 1260, destination: "acct_e1" });
    await handleDisputeCreated(dispute());
    expect(m.stripe.transfers.createReversal.mock.calls[0][1]).toMatchObject({ amount: 40 });
  });

  it("is handled once, however often Stripe sends it", async () => {
    await handleDisputeCreated(dispute());
    await handleDisputeCreated(dispute());
    expect(m.stripe.transfers.createReversal).toHaveBeenCalledTimes(1);
  });

  it("with no transfer, records it and alerts the team without reversing anything", async () => {
    m.stripe.charges.retrieve.mockResolvedValue({ id: "ch_1", payment_intent: "pi_1", transfer: null });
    await handleDisputeCreated(dispute());
    expect(m.stripe.transfers.createReversal).not.toHaveBeenCalled();
    expect(m.rows.get("dp_1")).toMatchObject({ reversedPence: 0 });
    expect(m.email).toHaveBeenCalled();
  });
});

describe("a claim closed", () => {
  it("won: the engineer's share goes back to them", async () => {
    await handleDisputeCreated(dispute());
    await handleDisputeClosed(dispute({ status: "won" }));
    expect(m.stripe.transfers.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 1300, destination: "acct_e1" }), { idempotencyKey: "dispute-return:dp_1" });
    expect(m.rows.get("dp_1")).toMatchObject({ status: "won", returnedTransferId: "tr_back" });
    expect(m.notify).toHaveBeenLastCalledWith("e1", expect.stringContaining("overturned"));
  });

  it("lost: nothing goes back", async () => {
    await handleDisputeCreated(dispute());
    await handleDisputeClosed(dispute({ status: "lost" }));
    expect(m.stripe.transfers.create).not.toHaveBeenCalled();
    expect(m.rows.get("dp_1")).toMatchObject({ status: "lost" });
  });

  it("closing twice hands back once", async () => {
    await handleDisputeCreated(dispute());
    await handleDisputeClosed(dispute({ status: "won" }));
    await handleDisputeClosed(dispute({ status: "won" }));
    expect(m.stripe.transfers.create).toHaveBeenCalledTimes(1);
  });
});

describe("a won claim Stripe won't pay back yet", () => {
  it("doesn't fail, and asks the team to hand it back", async () => {
    await handleDisputeCreated(dispute());
    m.stripe.transfers.create.mockRejectedValueOnce(new Error("insufficient available funds"));
    await expect(handleDisputeClosed(dispute({ status: "won" }))).resolves.toBeUndefined();
    expect(m.rows.get("dp_1")).toMatchObject({ status: "won", returnedTransferId: null });
    const html = (m.email.mock.calls.at(-1) as unknown as [{ html: string }])[0].html;
    expect(html).toContain("Send it to them from the Stripe dashboard");
  });
});
