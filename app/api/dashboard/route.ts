import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { activeMonthlyPence } from "@/lib/plans";
import { dueServices } from "@/lib/reminders";

// Mobile counterpart to the dashboard queries in app/page.tsx (Screen 02) —
// same logic, returned as JSON instead of rendered server-side.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { totalPence, count } = await activeMonthlyPence(engineerId);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newThisMonth = await prisma.plan.count({
    where: { engineerId, status: "ACTIVE", activatedAt: { gte: monthStart } },
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const failedRecently = await prisma.event.count({
    where: {
      name: "payment_failed",
      ts: { gte: thirtyDaysAgo },
      meta: { path: ["engineerId"], equals: engineerId },
    },
  });

  const customersTotal = await prisma.customer.count({ where: { engineerId } });
  const onPlan = await prisma.customer.count({
    where: { engineerId, plans: { some: { status: "ACTIVE" } } },
  });
  const noPlan = customersTotal - onPlan;
  const avgTier = await prisma.planTier.aggregate({
    where: { engineerId, archived: false },
    _avg: { priceMonthlyPence: true },
  });
  const avgPence = Math.round(avgTier._avg.priceMonthlyPence ?? 1200);
  const prizeYearlyPence = Math.round((noPlan / 5) * avgPence * 12);

  const now = new Date();
  const upcoming = (await dueServices(engineerId))
    .filter((d) => d.dueDate >= now)
    .slice(0, 3)
    .map((d) => ({ ...d, dueDate: d.dueDate.toISOString() }));

  return NextResponse.json({
    totalPence,
    count,
    newThisMonth,
    failedRecently,
    noPlan,
    prizeYearlyPence,
    upcoming,
  });
}
