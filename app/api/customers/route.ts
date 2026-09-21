import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { normaliseUkPhone } from "@/lib/phone";
import { track } from "@/lib/track";

// E7 — customer book, ranked by opportunity. Segments: all / on plan / not on
// plan (the default to-do list) / attention (payment issues, lapsed).
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [customers, failedEvents] = await Promise.all([
    prisma.customer.findMany({
      where: { engineerId },
      include: {
        plans: {
          select: {
            id: true,
            status: true,
            priceMonthlyPence: true,
            createdAt: true,
            activatedAt: true,
            linkOpenedAt: true,
            tierId: true,
            tier: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        properties: { include: { appliances: true } },
      },
    }),
    prisma.event.findMany({
      where: {
        name: "payment_failed",
        ts: { gte: thirtyDaysAgo },
        meta: { path: ["engineerId"], equals: engineerId },
      },
      select: { meta: true },
    }),
  ]);

  const failedPlanIds = new Set(
    failedEvents
      .map((e) => (e.meta as { planId?: string } | null)?.planId)
      .filter((x): x is string => Boolean(x)),
  );

  const now = Date.now();
  const rows = customers.map((c) => {
    const active = c.plans.find((p) => p.status === "ACTIVE" || p.status === "PAUSED");
    const lapsed = !active && c.plans.some((p) => p.status === "CANCELLED");
    const latestOffer = c.plans[0] ?? null;
    const offeredAt = latestOffer?.createdAt ?? null;
    const staleOffer =
      !active &&
      latestOffer != null &&
      !latestOffer.linkOpenedAt &&
      now - latestOffer.createdAt.getTime() > 7 * 864e5;
    const paymentIssue = c.plans.some((p) => failedPlanIds.has(p.id));
    const appliance = c.properties[0]?.appliances[0];
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      source: c.source,
      applianceLabel: appliance
        ? `${appliance.make ?? ""} ${appliance.model ?? ""}`.trim() || null
        : null,
      lastServicedAt: appliance?.lastServicedAt?.toISOString() ?? null,
      status: active
        ? active.status === "PAUSED"
          ? ("PAUSED" as const)
          : ("ACTIVE" as const)
        : lapsed
          ? ("LAPSED" as const)
          : ("NONE" as const),
      tierId: active?.tierId ?? null,
      tierName: active?.tier?.name ?? null,
      priceMonthlyPence: active?.priceMonthlyPence ?? null,
      activatedAt: active?.activatedAt?.toISOString() ?? null,
      neverOffered: c.plans.length === 0,
      offeredAt: offeredAt?.toISOString() ?? null,
      staleOffer,
      paymentIssue,
    };
  });

  // Not-on-plan sort: never-offered first, then stale offers, then newest.
  const notOnPlanRank = (r: (typeof rows)[number]) =>
    r.neverOffered ? 0 : r.staleOffer ? 1 : 2;
  rows.sort((a, b) => {
    const ra = notOnPlanRank(a);
    const rb = notOnPlanRank(b);
    if (ra !== rb) return ra - rb;
    return (b.offeredAt ?? "").localeCompare(a.offeredAt ?? "");
  });

  const onPlan = rows.filter((r) => r.status === "ACTIVE" || r.status === "PAUSED").length;
  const attention = rows.filter((r) => r.paymentIssue || r.status === "LAPSED").length;
  const counts = {
    all: rows.length,
    onPlan,
    notOnPlan: rows.filter((r) => r.status === "NONE").length,
    lapsed: rows.filter((r) => r.status === "LAPSED").length,
    attention,
  };

  return NextResponse.json({ customers: rows, counts });
}

const PostBody = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().min(6).max(20),
  addressLine1: z.string().max(120).optional(),
  town: z.string().max(60).optional(),
  postcode: z.string().max(12).optional(),
  // First-of-month date; only feeds the reminder engine, never shown as a
  // precise day.
  lastServicedAt: z.string().datetime().optional(),
});

// Build Guide v2 Part 9.3 — Add-customer sheet route 3, "Just save their
// details": deliberately plan-free, no offer, no plan tier. De-dupes by
// phone against the existing book (the same key /api/offer upserts on).
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the form and try again." }, { status: 400 });
  }
  const b = parsed.data;
  const phone = normaliseUkPhone(b.phone);
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
  }

  const customer = await prisma.customer.upsert({
    where: { engineerId_phone: { engineerId, phone } },
    update: { firstName: b.firstName, lastName: b.lastName },
    create: { engineerId, firstName: b.firstName, lastName: b.lastName, phone, source: "added" },
  });

  if (b.addressLine1 && b.postcode) {
    const existingProperty = await prisma.property.findFirst({ where: { customerId: customer.id } });
    const property =
      existingProperty ??
      (await prisma.property.create({
        data: { customerId: customer.id, addressLine1: b.addressLine1, town: b.town, postcode: b.postcode },
      }));
    if (existingProperty) {
      await prisma.property.update({
        where: { id: property.id },
        data: { addressLine1: b.addressLine1, town: b.town, postcode: b.postcode },
      });
    }

    if (b.lastServicedAt) {
      const appliance = await prisma.appliance.findFirst({ where: { propertyId: property.id } });
      if (appliance) {
        await prisma.appliance.update({
          where: { id: appliance.id },
          data: { lastServicedAt: new Date(b.lastServicedAt) },
        });
      } else {
        await prisma.appliance.create({
          data: { propertyId: property.id, type: "Boiler", lastServicedAt: new Date(b.lastServicedAt) },
        });
      }
    }
  }

  await track("customer_added_manually", { type: "ENGINEER", id: engineerId }, {
    customerId: customer.id,
    hadAddress: Boolean(b.addressLine1),
    hadLastService: Boolean(b.lastServicedAt),
  });
  return NextResponse.json({ ok: true, id: customer.id });
}
