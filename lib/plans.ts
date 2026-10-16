import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { BACS_PROCESSING_FEE_PENCE, TRADESURA_FEE_RATE } from "@/lib/clauses";

export function newToken() {
  return crypto.randomBytes(12).toString("base64url");
}

export async function newPlanRef() {
  for (;;) {
    const ref = `TSH-${crypto.randomInt(1000, 10000)}`;
    if (!(await prisma.plan.findUnique({ where: { ref } }))) return ref;
  }
}

export async function activeMonthlyPence(engineerId: string) {
  const agg = await prisma.plan.aggregate({
    where: { engineerId, status: "ACTIVE" },
    _sum: { priceMonthlyPence: true },
    _count: true,
  });
  return { totalPence: agg._sum.priceMonthlyPence ?? 0, count: agg._count };
}

// Build Guide v2 Parts 6.3 + 12 — payout maths from what actually cleared,
// never from the monthly plan total. Each confirmed collection loses exactly
// what Stripe's application_fee_amount takes (lib/stripe.ts
// computeApplicationFeePence: 20% rounded, plus the flat Bacs processing), so
// summing per collection reconciles to Stripe's records to the penny.
export async function collectionsSince(engineerId: string, since: Date) {
  const events = await prisma.event.findMany({
    where: {
      name: "payment_confirmed",
      ts: { gte: since },
      meta: { path: ["engineerId"], equals: engineerId },
    },
    select: { meta: true },
  });
  let collectedPence = 0;
  let feePence = 0;
  for (const e of events) {
    const amount = (e.meta as { amountPence?: number } | null)?.amountPence ?? 0;
    collectedPence += amount;
    feePence += Math.round(amount * TRADESURA_FEE_RATE);
  }
  const processingPence = events.length * BACS_PROCESSING_FEE_PENCE;
  return {
    count: events.length,
    collectedPence,
    feePence,
    processingPence,
    toBankPence: collectedPence - feePence - processingPence,
  };
}

// The payout week runs Monday → Friday (the dashboard ring fills over the
// same days — mobile/components/ring-progress.tsx).
export function payoutWeekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
