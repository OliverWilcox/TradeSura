import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { addMonths, passportBoiler } from "@/lib/passport";
import { requestRating } from "@/lib/ratings";
import { isOwnPhotoUrl, livePlanId, passportAccess } from "../access";

const Body = z.object({
  doneAt: z.string().datetime(),
  notes: z.string().trim().max(1000).optional(),
  photoUrls: z.array(z.string().url()).max(4).default([]),
  nextDueAt: z.string().datetime().optional(),
});

// Section 4 — "Log a service": a dated record on the home's passport (LIVE
// only), the boiler's service clock reset, and — for a plan holder — the
// one-tap rating request (Section 5).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await passportAccess(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.passportId) {
    return NextResponse.json({ error: "This customer doesn't have a Home Passport yet." }, { status: 409 });
  }
  if (access.state !== "LIVE") {
    return NextResponse.json(
      { error: "This Home Passport is frozen — new records are only added while a plan is active." },
      { status: 409 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the date and try again." }, { status: 400 });
  const { notes, photoUrls } = parsed.data;
  if (photoUrls.some((u) => !isOwnPhotoUrl(u))) {
    return NextResponse.json({ error: "Add photos from the app." }, { status: 400 });
  }
  const doneAt = new Date(parsed.data.doneAt);
  if (doneAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "The service date can't be in the future." }, { status: 400 });
  }
  const nextDueAt = parsed.data.nextDueAt ? new Date(parsed.data.nextDueAt) : addMonths(doneAt, 12);
  if (nextDueAt <= doneAt) {
    return NextResponse.json({ error: "Next due has to be after the service date." }, { status: 400 });
  }

  const businessId = access.actor.businessId;
  const passportId = access.passportId;
  let boiler = await passportBoiler(passportId);
  if (!boiler) {
    const property = await prisma.property.findFirst({ where: { customerId: id, passportId }, select: { id: true } });
    if (property) {
      boiler = await prisma.appliance.create({ data: { propertyId: property.id, passportId, type: "Boiler" } });
    }
  }
  const planId = await livePlanId(businessId, id);

  const record = await prisma.serviceRecord.create({
    data: {
      passportId,
      applianceId: boiler?.id ?? null,
      engineerId: businessId,
      planId,
      kind: "service",
      doneAt,
      notes: notes || null,
      photoUrls,
      nextDueAt,
    },
  });
  // Keeps the reminder engine and the customer page's "Last service" in step.
  if (boiler && (!boiler.lastServicedAt || boiler.lastServicedAt < doneAt)) {
    await prisma.appliance.update({ where: { id: boiler.id }, data: { lastServicedAt: doneAt } });
  }

  await track("service_recorded", { type: "ENGINEER", id: access.actor.actorId }, {
    customerId: id,
    servicedOn: doneAt.toISOString(),
    serviceRecordId: record.id,
    photos: photoUrls.length,
  });

  const { requested } = await requestRating(record.id);
  return NextResponse.json({ ok: true, id: record.id, ratingRequested: requested });
}
