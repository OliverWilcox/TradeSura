import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { passportBoiler, passportState } from "@/lib/passport";
import { storePassportPhoto } from "@/lib/passport-photo";
import { MAX_BOILER_PHOTOS, MAX_SETUP_UPLOAD, fittedDate, homeownerBoilerPatch } from "@/lib/passport-setup";

const Body = z.object({
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  year: z.number().int().nullable().optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  photos: z
    .array(z.object({ base64: z.string().min(1), mimeType: z.string().min(1) }))
    .max(MAX_SETUP_UPLOAD)
    .optional(),
});

// Retention §9 — the homeowner sets up their Home Passport from the private
// link (no account: holding the viewToken is the permission). Fills blanks
// only; whatever an engineer entered stays as they entered it.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const passport = await prisma.homePassport.findUnique({ where: { viewToken: token }, select: { id: true } });
  if (!passport) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if ((await passportState(passport.id)) !== "LIVE") {
    return NextResponse.json({ error: "There's no active plan on this home, so it can't be changed." }, { status: 409 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the details and try again." }, { status: 400 });
  const input = parsed.data;

  let boiler = await passportBoiler(passport.id);
  if (!boiler) {
    const property = await prisma.property.findFirst({ where: { passportId: passport.id }, select: { id: true } });
    if (!property) return NextResponse.json({ error: "We couldn't find your home's details." }, { status: 409 });
    boiler = await prisma.appliance.create({ data: { propertyId: property.id, passportId: passport.id, type: "Boiler" } });
  }

  const room = Math.max(0, MAX_BOILER_PHOTOS - boiler.photoUrls.length);
  const photoUrls: string[] = [];
  for (const p of (input.photos ?? []).slice(0, room)) {
    const stored = await storePassportPhoto(p.base64, p.mimeType);
    if ("error" in stored) return NextResponse.json({ error: stored.error }, { status: 400 });
    photoUrls.push(stored.url);
  }

  const { data, filled } = homeownerBoilerPatch(boiler, {
    make: input.make,
    model: input.model,
    installedAt: fittedDate(input.year ?? null, input.month ?? null),
    photoUrls,
  });
  if (filled.length) {
    await prisma.appliance.update({ where: { id: boiler.id }, data });
    await track("passport_setup_by_homeowner", { type: "CUSTOMER" }, { passportId: passport.id, filled });
  }
  return NextResponse.json({ ok: true, filled });
}
