import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";

// Mobile counterpart to the customer-book query in app/customers/page.tsx.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const customers = await prisma.customer.findMany({
    where: { engineerId },
    orderBy: { createdAt: "desc" },
    include: {
      plans: { select: { status: true, priceMonthlyPence: true, tier: { select: { name: true } } } },
      properties: { include: { appliances: true } },
    },
  });

  const withStatus = customers.map((c) => {
    const active = c.plans.find((p) => p.status === "ACTIVE");
    const lapsed = !active && c.plans.some((p) => p.status === "CANCELLED");
    const appliance = c.properties[0]?.appliances[0];
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      applianceLabel: appliance
        ? `${appliance.make ?? ""} ${appliance.model ?? ""}`.trim() || null
        : null,
      lastServicedAt: appliance?.lastServicedAt?.toISOString() ?? null,
      status: active ? ("ACTIVE" as const) : lapsed ? ("LAPSED" as const) : ("NONE" as const),
      tierName: active?.tier?.name ?? null,
      priceMonthlyPence: active?.priceMonthlyPence ?? null,
    };
  });

  const counts = {
    all: withStatus.length,
    onPlan: withStatus.filter((c) => c.status === "ACTIVE").length,
    lapsed: withStatus.filter((c) => c.status === "LAPSED").length,
  };

  return NextResponse.json({ customers: withStatus, counts });
}
