import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";

const Body = z.object({
  servicedOn: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
});

// E7b — "Record a service". Stamps the appliance (creating a bare
// property/appliance if the customer has none) so the reminder engine
// reschedules next year's service off this date.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineerId = actor.businessId;
  // Section 8 — staff only act on customers they added.
  const ownOnly = actor.role === "staff" ? { addedById: actor.actorId } : {};

  const { id } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const servicedOn = parsed.data.servicedOn ? new Date(parsed.data.servicedOn) : new Date();

  const customer = await prisma.customer.findFirst({
    where: { id, engineerId, ...ownOnly },
    include: { properties: { include: { appliances: true } } },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const existing = customer.properties[0]?.appliances[0];
  let lastServicedAt: Date;
  if (existing) {
    const updated = await prisma.appliance.update({
      where: { id: existing.id },
      data: { lastServicedAt: servicedOn },
    });
    lastServicedAt = updated.lastServicedAt!;
  } else {
    const propertyId =
      customer.properties[0]?.id ??
      (
        await prisma.property.create({
          data: { customerId: id, addressLine1: "—", postcode: "—" },
        })
      ).id;
    const created = await prisma.appliance.create({
      data: { propertyId, type: "Boiler", lastServicedAt: servicedOn },
    });
    lastServicedAt = created.lastServicedAt!;
  }

  await track("service_recorded", { type: "ENGINEER", id: engineerId }, {
    customerId: id,
    servicedOn: servicedOn.toISOString(),
    note: parsed.data.note,
  });
  return NextResponse.json({ ok: true, lastServicedAt });
}
