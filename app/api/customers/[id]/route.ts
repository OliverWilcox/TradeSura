import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { cancelScheduledSms } from "@/lib/sms";
import { resolvePlanTier } from "@/lib/plan-tier";
import { nextServiceDate } from "@/lib/reminders";

type TimelineItem = { at: string; icon: string; text: string };

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const customer = await prisma.customer.findFirst({
    where: { id, engineerId },
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
  const payments = planIds.length
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
    address: customer.properties[0]
      ? [customer.properties[0].addressLine1, customer.properties[0].town, customer.properties[0].postcode]
          .filter(Boolean)
          .join(", ")
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
          priceMonthlyPence: active.priceMonthlyPence ?? 0,
          benefitLines: signedTier?.clauses.map((c) => c.title) ?? [],
          status: active.status,
          mandateStatus: active.mandateStatus,
          activatedAt: active.activatedAt?.toISOString() ?? null,
        }
      : null,
    canTextManageLink: Boolean(mostRecentPlan),
    timeline,
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const customer = await prisma.customer.findFirst({
    where: { id, engineerId },
    include: { plans: true },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (customer.plans.some((p) => p.status === "ACTIVE" || p.status === "PAUSED")) {
    return NextResponse.json(
      { error: "This customer has a live plan — text them the manage link to cancel it." },
      { status: 409 },
    );
  }

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
