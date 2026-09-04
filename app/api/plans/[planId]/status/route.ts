import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { activeMonthlyPence } from "@/lib/plans";

export async function GET(_req: Request, ctx: { params: Promise<{ planId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { planId } = await ctx.params;
  const plan = await prisma.plan.findFirst({
    where: { id: planId, engineerId },
    include: { customer: { select: { firstName: true, lastName: true } } },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const income = await activeMonthlyPence(engineerId);
  return NextResponse.json({
    status: plan.status,
    opened: Boolean(plan.linkOpenedAt),
    tierChosen: Boolean(plan.tierId),
    bankStarted: Boolean(plan.stripeSubscriptionId),
    priceMonthlyPence: plan.priceMonthlyPence,
    customerFirstName: plan.customer.firstName,
    customerLastName: plan.customer.lastName,
    incomeMonthlyPence: income.totalPence,
    activePlans: income.count,
  });
}
