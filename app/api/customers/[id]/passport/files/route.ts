import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { passportBoiler } from "@/lib/passport";
import { FILE_KIND_KEYS, fileView, storePassportFile } from "@/lib/passport-files";
import { passportAccess } from "../access";

const Body = z.object({
  kind: z.enum(FILE_KIND_KEYS),
  label: z.string().trim().max(80).optional(),
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  // On a logged visit, or (left out) on the boiler.
  recordId: z.string().min(1).optional(),
});

// Matt, 4 Nov — photos and documents on the boiler or a visit. The engineer
// (business) only ever sees and removes their own; the homeowner sees all.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await passportAccess(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  if (!access.passportId) return NextResponse.json({ files: [] });
  const files = await prisma.passportFile.findMany({
    where: { passportId: access.passportId, engineerId: access.actor.businessId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ files: files.map(fileView) });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
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
  if (!parsed.success) return NextResponse.json({ error: "Add a photo or a PDF." }, { status: 400 });
  const { kind, label, base64, mimeType, recordId } = parsed.data;
  const businessId = access.actor.businessId;
  const passportId = access.passportId;

  // A visit has to be one of this engineer's own, on this home.
  let applianceId: string | null = null;
  if (recordId) {
    const record = await prisma.serviceRecord.findFirst({
      where: { id: recordId, passportId, engineerId: businessId },
      select: { id: true, applianceId: true },
    });
    if (!record) return NextResponse.json({ error: "Not found." }, { status: 404 });
    applianceId = record.applianceId;
  } else {
    let boiler = await passportBoiler(passportId);
    if (!boiler) {
      const property = await prisma.property.findFirst({ where: { customerId: id, passportId }, select: { id: true } });
      if (!property) return NextResponse.json({ error: "Not found." }, { status: 404 });
      boiler = await prisma.appliance.create({ data: { propertyId: property.id, passportId, type: "Boiler" } });
    }
    applianceId = boiler.id;
  }

  const stored = await storePassportFile(base64, mimeType);
  if ("error" in stored) return NextResponse.json({ error: stored.error }, { status: 400 });
  const file = await prisma.passportFile.create({
    data: {
      passportId,
      applianceId,
      serviceRecordId: recordId ?? null,
      engineerId: businessId,
      kind,
      label: label || null,
      url: stored.url,
      contentType: stored.contentType,
    },
  });
  await track("passport_file_added", { type: "ENGINEER", id: access.actor.actorId }, { customerId: id, kind, onVisit: Boolean(recordId) });
  return NextResponse.json({ file: fileView(file) });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await passportAccess(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const fileId = new URL(req.url).searchParams.get("fileId");
  if (!access.passportId || !fileId) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { count } = await prisma.passportFile.deleteMany({
    where: { id: fileId, passportId: access.passportId, engineerId: access.actor.businessId },
  });
  if (count === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
