import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { dueServices } from "@/lib/reminders";

// Mobile counterpart to the jobs queries in app/jobs/page.tsx (Screen 07, lite).
export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineerId = actor.businessId;
  const addedById = actor.role === "staff" ? actor.actorId : undefined;

  const due = await dueServices(engineerId, { addedById });
  const now = new Date();
  const upcoming = due.filter((d) => d.dueDate >= now);
  const overdue = due.filter((d) => d.dueDate < now);

  const pastAppliances = await prisma.appliance.findMany({
    where: {
      lastServicedAt: { not: null, lt: now },
      property: { customer: { engineerId, ...(addedById ? { addedById } : {}) } },
    },
    include: { property: { include: { customer: true } } },
    orderBy: { lastServicedAt: "desc" },
  });

  return NextResponse.json({
    upcoming: upcoming.map((d) => ({ ...d, dueDate: d.dueDate.toISOString() })),
    overdue: overdue.map((d) => ({ ...d, dueDate: d.dueDate.toISOString() })),
    past: pastAppliances.map((a) => ({
      id: a.id,
      customerName: `${a.property.customer.firstName} ${a.property.customer.lastName}`,
      applianceLabel: `${a.make ?? ""} ${a.model ?? ""}`.trim() || "Boiler",
      lastServicedAt: a.lastServicedAt!.toISOString(),
    })),
  });
}
