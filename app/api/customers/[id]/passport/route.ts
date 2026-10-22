import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addMonths, passportBoiler, passportLeads } from "@/lib/passport";
import { stickerStock } from "@/lib/stickers";
import { passportAccess } from "./access";

// Section 4 — the Home Passport section on the engineer's customer page.
// The engineer sees only their own records; the homeowner's link (which
// shows every engineer's records) is never handed to the engineer app.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await passportAccess(id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const businessId = access.actor.businessId;
  const stock = await stickerStock(businessId);

  if (!access.passportId) {
    return NextResponse.json({
      passport: null,
      reason: "Their Home Passport starts when they join a plan with a full address.",
      stock,
    });
  }

  const [passport, boiler, records] = await Promise.all([
    prisma.homePassport.findUniqueOrThrow({
      where: { id: access.passportId },
      select: {
        addressLine1: true,
        town: true,
        postcode: true,
        contactConsentAt: true,
        stickers: { where: { engineerId: businessId }, select: { code: true, linkedAt: true } },
      },
    }),
    passportBoiler(access.passportId),
    prisma.serviceRecord.findMany({
      where: { passportId: access.passportId, engineerId: businessId },
      orderBy: { doneAt: "desc" },
      include: { rating: { select: { stars: true, ratedAt: true } } },
    }),
  ]);

  const lastService = records.find((r) => r.kind === "service");
  const nextDueAt =
    records.find((r) => r.nextDueAt)?.nextDueAt ??
    (boiler?.lastServicedAt ? addMonths(boiler.lastServicedAt, 12) : null);

  return NextResponse.json({
    passport: {
      state: access.state,
      address: [passport.addressLine1, passport.town, passport.postcode].filter(Boolean).join(", "),
      boiler: boiler
        ? {
            make: boiler.make,
            model: boiler.model,
            type: boiler.type,
            installedAt: boiler.installedAt?.toISOString() ?? null,
            photoUrls: boiler.photoUrls,
          }
        : null,
      records: records.map((r) => ({
        id: r.id,
        kind: r.kind,
        doneAt: r.doneAt.toISOString(),
        notes: r.notes,
        photoUrls: r.photoUrls,
        nextDueAt: r.nextDueAt?.toISOString() ?? null,
        stars: r.rating?.ratedAt ? r.rating.stars : null,
        ratingRequested: Boolean(r.rating),
      })),
      lastServicedAt: (lastService?.doneAt ?? boiler?.lastServicedAt)?.toISOString() ?? null,
      nextDueAt: nextDueAt?.toISOString() ?? null,
      stickers: passport.stickers.map((s) => ({ code: s.code, linkedAt: s.linkedAt?.toISOString() ?? null })),
      consent: Boolean(passport.contactConsentAt),
      leads: passportLeads({
        contactConsentAt: passport.contactConsentAt,
        boilerInstalledAt: boiler?.installedAt ?? null,
        ownNotes: records.slice(0, 3).map((r) => r.notes),
      }),
      canAdd: access.state === "LIVE",
    },
    stock,
  });
}
