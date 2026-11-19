import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as engineer } from "@/app/api/admin/v1/engineers/[engineerId]/route";
import { call, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(resetDb);

describe("disputes on the record", () => {
  it("lists each Stripe dispute newest first, with what was taken, what wasn't and what went back", async () => {
    const e = await makeEngineer({ stripeAccountId: "acct_a" });
    const c = await makeCustomer(e.id, { firstName: "Sarah", lastName: "Jones" });
    const p = await makePlan(e.id, c.id);
    await prisma.planDispute.create({ data: { stripeDisputeId: "dp_1", chargeId: "ch_1", planId: p.id, engineerId: e.id, amountPence: 1500, reason: "debit_not_authorized", status: "lost", reversedPence: 1200, reversalId: "trr_1", feePence: 500, feeDebitId: null, createdAt: new Date("2026-11-01T10:00:00Z"), closedAt: new Date("2026-11-08T10:00:00Z") } });
    await prisma.planDispute.create({ data: { stripeDisputeId: "dp_2", chargeId: "ch_2", planId: p.id, engineerId: e.id, amountPence: 1500, reason: "debit_not_authorized", status: "won", reversedPence: 1500, reversalId: "trr_2", feePence: 500, feeDebitId: "tr_fee", createdAt: new Date("2026-11-03T10:00:00Z"), closedAt: new Date("2026-11-10T10:00:00Z"), returnedTransferId: "tr_back" } });
    await prisma.planDispute.create({ data: { stripeDisputeId: "dp_3", chargeId: "ch_3", planId: null, engineerId: e.id, amountPence: 900, reason: null, status: "needs_response", reversedPence: 900, feePence: 500, feeDebitId: "tr_fee3", createdAt: new Date("2026-11-12T10:00:00Z") } });
    await prisma.planDispute.create({ data: { stripeDisputeId: "dp_4", chargeId: "ch_4", engineerId: "someone_else", amountPence: 900, status: "lost" } });
    const res = await call(engineer, { params: { engineerId: e.id } });
    expect(res.status).toBe(200);
    expect(res.body.disputes).toEqual([
      { at: "2026-11-12T10:00:00.000Z", closedAt: null, kind: "payment_disputed", disputeId: "dp_3", amountPence: 900, feePence: 500, reversedPence: 1400, shortfallPence: 0, returnedPence: null, handBackDuePence: null, reason: null, plan: null },
      { at: "2026-11-03T10:00:00.000Z", closedAt: "2026-11-10T10:00:00.000Z", kind: "dispute_won", disputeId: "dp_2", amountPence: 1500, feePence: 500, reversedPence: 2000, shortfallPence: 0, returnedPence: 1500, handBackDuePence: null, reason: "debit_not_authorized", plan: { ref: p.ref, customer: "Sarah Jones" } },
      { at: "2026-11-01T10:00:00.000Z", closedAt: "2026-11-08T10:00:00.000Z", kind: "dispute_lost", disputeId: "dp_1", amountPence: 1500, feePence: 500, reversedPence: 1200, shortfallPence: 800, returnedPence: null, handBackDuePence: null, reason: "debit_not_authorized", plan: { ref: p.ref, customer: "Sarah Jones" } },
    ]);
  });
});
