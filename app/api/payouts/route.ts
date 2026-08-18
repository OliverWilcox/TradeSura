import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { activeMonthlyPence } from "@/lib/plans";
import { appFeePence } from "@/lib/clauses";

// Mobile counterpart to app/payouts/page.tsx (restored — see CLAUDE.md's
// 2026-08-03 scope note). The More hub's inline card is just the summary;
// this is the fuller breakdown + failed-collection recovery list.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { totalPence, count } = await activeMonthlyPence(engineerId);
  const fee = appFeePence(totalPence);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [confirmed, failedEvents] = await Promise.all([
    prisma.event.count({
      where: {
        name: "payment_confirmed",
        ts: { gte: monthStart },
        meta: { path: ["engineerId"], equals: engineerId },
      },
    }),
    prisma.event.findMany({
      where: {
        name: "payment_failed",
        ts: { gte: thirtyDaysAgo },
        meta: { path: ["engineerId"], equals: engineerId },
      },
      orderBy: { ts: "desc" },
    }),
  ]);

  const failedPlanIds = [
    ...new Set(
      failedEvents
        .map((e) => (e.meta as { planId?: string } | null)?.planId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const failedPlans = await prisma.plan.findMany({
    where: { id: { in: failedPlanIds } },
    include: { customer: true },
  });

  return NextResponse.json({
    totalPence,
    count,
    fee,
    confirmed,
    failedPlans: failedPlans.map((p) => ({
      id: p.id,
      customerName: `${p.customer.firstName} ${p.customer.lastName}`,
      priceMonthlyPence: p.priceMonthlyPence ?? 0,
    })),
  });
}
