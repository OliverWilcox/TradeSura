import { NextResponse } from "next/server";
import { z } from "zod";
import { normaliseUkPhone } from "@/lib/phone";
import { removeBlockedReason } from "@/lib/customer-remove";
import { prisma } from "@/lib/db";
import { RESCUE_GRACE_DAYS } from "@/lib/plan-billing";
import { getActor, getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { cancelScheduledSms } from "@/lib/sms";
import { resolvePlanTier } from "@/lib/plan-tier";
import { nextServiceDate } from "@/lib/reminders";

type TimelineItem = { at: string; icon: string; text: string };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineerId = actor.businessId;
  // Section 8 — staff open only customers they added, without payment detail.
  const isStaff = actor.role === "staff";

  const { id } = await ctx.params;
  const customer = await prisma.customer.findFirst({
    where: { id, engineerId, ...(isStaff ? { addedById: actor.actorId } : {}) },
    include: {
      properties: { include: { appliances: true } },
      plans: {
        include: { tier: { include: { clauses: { include: { clause: true } } } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // A paused plan is still "on a plan" — only a cancelled one isn't.
  const active = customer.plans.find((p) => p.status === "ACTIVE" || p.status === "PAUSED");
  // Part 10 — "Text the manage link" needs a portal token for whatever the
  // customer's most relevant plan is, active or not (a lapsed customer can
  // still open their old portal to see history).
  const mostRecentPlan = active ?? customer.plans[0] ?? null;
  const planIds = customer.plans.map((p) => p.id);
  const payments = planIds.length && !isStaff
    ? await prisma.event.findMany({
        where: {
          name: "payment_confirmed",
          OR: planIds.map((pid) => ({ meta: { path: ["planId"], equals: pid } })),
        },
        orderBy: { ts: "desc" },
        take: 12,
      })
    : [];

  const appliance = customer.properties[0]?.appliances[0];
  const timeline: TimelineItem[] = [];
  for (const p of customer.plans) {
    if (p.activatedAt) {
      timeline.push({
        at: p.activatedAt.toISOString(),
        icon: "⭐",
        text: `Joined ${p.tier?.name ?? "a plan"}`,
      });
    } else {
      timeline.push({ at: p.createdAt.toISOString(), icon: "📨", text: "Plan offer sent" });
    }
    if (p.cancelledAt) {
      timeline.push({ at: p.cancelledAt.toISOString(), icon: "✕", text: "Plan cancelled" });
    }
  }
  if (appliance?.lastServicedAt) {
    timeline.push({
      at: appliance.lastServicedAt.toISOString(),
      icon: "🔧",
      text: "Service recorded",
    });
  }
  for (const e of payments) {
    const pence = (e.meta as { amountPence?: number } | null)?.amountPence ?? 0;
    timeline.push({
      at: e.ts.toISOString(),
      icon: "💷",
      text: pence ? `£${(pence / 100).toFixed(2)} collected` : "Payment collected",
    });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  // Part 10 — "'Her plan — as signed' card showing the signed version
  // (title, price, benefits — frozen snapshot, Part 7.2)." No pronoun is
  // ever captured at signup, so this always falls back to "Their plan —
  // as signed" rather than guessing one.
  const signedTier = active ? resolvePlanTier(active) : null;

  const nextDue = appliance?.lastServicedAt
    ? nextServiceDate(appliance.lastServicedAt)
    : active?.activatedAt
      ? nextServiceDate(active.activatedAt)
      : null;

  return NextResponse.json({
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    phone: customer.phone,
    email: customer.email,
    source: customer.source,
    // Retention §4 — the Home Passport section takes over the service card.
    hasPassport: customer.properties.some((p) => p.passportId),
    address: customer.properties[0]
      ? [customer.properties[0].addressLine1, customer.properties[0].town, customer.properties[0].postcode]
          .filter(Boolean)
          .join(", ")
      : null,
    // Review 4 — the parts, for the Edit form.
    addressParts: customer.properties[0]
      ? {
          line1: customer.properties[0].addressLine1,
          town: customer.properties[0].town ?? "",
          postcode: customer.properties[0].postcode,
        }
      : null,
    appliance: appliance
      ? {
          label: `${appliance.make ?? ""} ${appliance.model ?? ""}`.trim() || appliance.type || "Appliance",
          lastServicedAt: appliance.lastServicedAt?.toISOString() ?? null,
        }
      : null,
    nextServiceDue: nextDue?.toISOString() ?? null,
    serviceOverdue: Boolean(nextDue && nextDue.getTime() < Date.now()),
    plan: active
      ? {
          id: active.id,
          tierName: signedTier?.name ?? active.tier?.name ?? "Plan",
          priceMonthlyPence: isStaff ? null : (active.priceMonthlyPence ?? 0),
          benefitLines: signedTier?.clauses.map((c) => c.title) ?? [],
          status: active.status,
          mandateStatus: isStaff ? null : active.mandateStatus,
          activatedAt: active.activatedAt?.toISOString() ?? null,
          // Retention §3 — the installer sees a failed payment and the grace
          // period, so they can follow up personally.
          paymentFailedAt: active.paymentFailedAt?.toISOString() ?? null,
          paymentEndsAt: active.paymentFailedAt
            ? new Date(active.paymentFailedAt.getTime() + RESCUE_GRACE_DAYS * 86_400_000).toISOString()
            : null,
        }
      : null,
    canTextManageLink: Boolean(mostRecentPlan),
    removeBlocked: removeBlockedReason(customer),
    // Ending a plan and removing a customer are owner actions.
    viewerIsStaff: isStaff,
    timeline,
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const customer = await prisma.customer.findFirst({
    where: { id, engineerId },
    include: { plans: true, properties: { select: { passportId: true } } },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const blocked = removeBlockedReason(customer);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  for (const p of customer.plans) {
    await cancelScheduledSms(`nudge:${p.id}`);
    await cancelScheduledSms(`svc:${p.id}`);
  }
  await prisma.$transaction([
    prisma.plan.deleteMany({ where: { customerId: id } }),
    prisma.appliance.deleteMany({
      where: { property: { customerId: id } },
    }),
    prisma.property.deleteMany({ where: { customerId: id } }),
    prisma.customer.delete({ where: { id } }),
  ]);
  await track("customer_removed", { type: "ENGINEER", id: engineerId }, { customerId: id });
  return NextResponse.json({ ok: true });
}

const PatchBody = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: z.string().min(6).max(20).optional(),
  email: z.union([z.string().trim().email().max(200), z.literal("")]).optional(),
  addressLine1: z.string().trim().max(120).optional(),
  town: z.string().trim().max(60).optional(),
  postcode: z.string().trim().max(12).optional(),
  // Month picker: first of the month, or null to clear.
  lastServicedAt: z.string().datetime().nullable().optional(),
});

// Review 4 — edit a customer's name, mobile, email, address and last service.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineerId = actor.businessId;
  const isStaff = actor.role === "staff";

  const { id } = await ctx.params;
  const customer = await prisma.customer.findFirst({
    where: { id, engineerId, ...(isStaff ? { addedById: actor.actorId } : {}) },
    include: { properties: { include: { appliances: true } } },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the details and try again." }, { status: 400 });
  const b = parsed.data;

  let phone: string | undefined;
  if (b.phone !== undefined) {
    const n = normaliseUkPhone(b.phone);
    if (!n) return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
    if (n !== customer.phone) {
      const clash = await prisma.customer.findUnique({ where: { engineerId_phone: { engineerId, phone: n } } });
      if (clash) {
        return NextResponse.json({ error: "Another customer in your book already has that mobile." }, { status: 409 });
      }
    }
    phone = n;
  }

  await prisma.customer.update({
    where: { id },
    data: {
      ...(b.firstName !== undefined ? { firstName: b.firstName } : {}),
      ...(b.lastName !== undefined ? { lastName: b.lastName } : {}),
      ...(phone ? { phone } : {}),
      ...(b.email !== undefined ? { email: b.email || null } : {}),
    },
  });

  let property = customer.properties[0] ?? null;
  const addressGiven = b.addressLine1 !== undefined || b.postcode !== undefined || b.town !== undefined;
  if (addressGiven) {
    const line1 = b.addressLine1 ?? property?.addressLine1 ?? "";
    const postcode = (b.postcode ?? property?.postcode ?? "").toUpperCase();
    if (line1 && postcode) {
      const data = { addressLine1: line1, town: b.town ?? property?.town ?? null, postcode };
      property = property
        ? await prisma.property.update({ where: { id: property.id }, data, include: { appliances: true } })
        : await prisma.property.create({ data: { customerId: id, ...data }, include: { appliances: true } });
    } else if (line1 || postcode) {
      return NextResponse.json({ error: "Add both the first line of the address and the postcode." }, { status: 400 });
    }
  }

  if (b.lastServicedAt !== undefined) {
    if (!property) {
      return NextResponse.json({ error: "Add their address first, then the last service." }, { status: 400 });
    }
    const when = b.lastServicedAt ? new Date(b.lastServicedAt) : null;
    const appliance = property.appliances[0];
    if (appliance) {
      await prisma.appliance.update({ where: { id: appliance.id }, data: { lastServicedAt: when } });
    } else if (when) {
      await prisma.appliance.create({ data: { propertyId: property.id, type: "Boiler", lastServicedAt: when } });
    }
  }

  await track("customer_edited", { type: "ENGINEER", id: actor.actorId }, { engineerId, customerId: id });
  return NextResponse.json({ ok: true });
}
