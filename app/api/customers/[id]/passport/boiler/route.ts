import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { passportBoiler } from "@/lib/passport";
import { isOwnPhotoUrl, passportAccess } from "../access";

const Body = z.object({
  make: z.string().trim().max(60).optional(),
  model: z.string().trim().max(60).optional(),
  installedAt: z.string().datetime().nullable().optional(),
  photoUrls: z.array(z.string().url()).max(4).optional(),
});

// Section 4 — the boiler on the passport: make, model, install date, photos.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await passportAccess(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.passportId) {
    return NextResponse.json({ error: "This customer doesn't have a Home Passport yet." }, { status: 409 });
  }
  if (access.state !== "LIVE") {
    return NextResponse.json({ error: "This Home Passport is frozen — it can't be changed." }, { status: 409 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the boiler details." }, { status: 400 });
  const { make, model, installedAt, photoUrls } = parsed.data;
  if (photoUrls?.some((u) => !isOwnPhotoUrl(u))) {
    return NextResponse.json({ error: "Add photos from the app." }, { status: 400 });
  }
  if (installedAt && new Date(installedAt).getTime() > Date.now()) {
    return NextResponse.json({ error: "The fitted date can't be in the future." }, { status: 400 });
  }

  const data = {
    ...(make !== undefined ? { make: make || null } : {}),
    ...(model !== undefined ? { model: model || null } : {}),
    ...(installedAt !== undefined ? { installedAt: installedAt ? new Date(installedAt) : null } : {}),
    ...(photoUrls !== undefined ? { photoUrls } : {}),
  };
  const boiler = await passportBoiler(access.passportId);
  if (boiler) {
    await prisma.appliance.update({ where: { id: boiler.id }, data });
  } else {
    const property = await prisma.property.findFirst({
      where: { customerId: id, passportId: access.passportId },
      select: { id: true },
    });
    if (!property) return NextResponse.json({ error: "Not found." }, { status: 404 });
    await prisma.appliance.create({
      data: { ...data, propertyId: property.id, passportId: access.passportId, type: "Boiler" },
    });
  }
  await track("passport_boiler_updated", { type: "ENGINEER", id: access.actor.actorId }, { customerId: id });
  return NextResponse.json({ ok: true });
}
