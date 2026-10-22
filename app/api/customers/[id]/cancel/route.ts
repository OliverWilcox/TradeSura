import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor, getEngineerId } from "@/lib/auth";
import { brandName } from "@/lib/engineer";
import { appUrl } from "@/lib/app-url";
import { sendSms } from "@/lib/sms";
import { track } from "@/lib/track";
import { cancelContext, requestCancel, undoCancellation } from "@/lib/cancel-plan";
import { pounds, reasonLabel, type CancelReason } from "@/lib/retention";

// Retention spec, section 2 — the installer's "Wants to cancel" card on the
// customer page. The installer can call, offer a cheaper plan, or mark the
// customer as saved (reversible in one tap). They can never block or delay
// a cancellation. Staff see the card without money and can only call.

const SAVED_SHOWN_DAYS = 14;

async function livePlan(customerId: string, engineerId: string, addedById?: string) {
  return prisma.plan.findFirst({
    where: {
      customerId,
      engineerId,
      status: { in: ["ACTIVE", "PAUSED"] },
      ...(addedById ? { customer: { addedById } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const isStaff = actor.role === "staff";
  const { id } = await ctx.params;
  const plan = await livePlan(id, actor.businessId, isStaff ? actor.actorId : undefined);
  if (!plan) return NextResponse.json({ state: null });

  const latest = await prisma.cancelRequest.findFirst({ where: { planId: plan.id }, orderBy: { createdAt: "desc" } });
  const now = new Date();
  const wantsToCancel = Boolean(plan.cancelRequestedAt && plan.cancelEffectiveAt && plan.cancelEffectiveAt > now);
  // A save the installer marked can be reversed for a couple of weeks.
  let savedByEngineer = false;
  if (!wantsToCancel && latest?.outcome === "saved" && latest.resolvedAt) {
    const recent = latest.resolvedAt.getTime() > now.getTime() - SAVED_SHOWN_DAYS * 86_400_000;
    const undone = recent
      ? await prisma.event.findFirst({
          where: {
            name: "plan_cancel_undone",
            ts: { gte: latest.createdAt },
            AND: [{ meta: { path: ["planId"], equals: plan.id } }, { meta: { path: ["by"], equals: "engineer" } }],
          },
        })
      : null;
    savedByEngineer = Boolean(undone);
  }
  if (!wantsToCancel && !savedByEngineer) return NextResponse.json({ state: null });

  const { plan: full, tier, serviceUsed, cheaper } = await cancelContext(plan.id);
  return NextResponse.json({
    state: wantsToCancel ? "wants_to_cancel" : "saved",
    requestId: latest?.id ?? null,
    reason: latest ? reasonLabel(latest.reason) : null,
    source: latest?.source ?? null,
    effectiveAt: full.cancelEffectiveAt?.toISOString() ?? null,
    customerFirstName: full.customer.firstName,
    customerName: `${full.customer.firstName} ${full.customer.lastName}`,
    phone: full.customer.phone,
    tierName: tier?.name ?? "Plan",
    priceMonthlyPence: isStaff ? null : (full.priceMonthlyPence ?? 0),
    customerSince: (full.activatedAt ?? full.createdAt).toISOString(),
    serviceUsed,
    cheaper:
      !isStaff && cheaper.kind === "cheaper_plan"
        ? { id: cheaper.tier.id, name: cheaper.tier.name, priceMonthlyPence: cheaper.tier.priceMonthlyPence }
        : null,
    canAct: !isStaff,
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saved") }),
  z.object({ action: z.literal("reinstate") }),
  z.object({ action: z.literal("offer_cheaper") }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const { id } = await ctx.params;
  const plan = await livePlan(id, engineerId);
  if (!plan) return NextResponse.json({ error: "This customer has no live plan." }, { status: 404 });

  if (parsed.data.action === "saved") {
    const result = await undoCancellation(plan.id, "engineer");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  }

  if (parsed.data.action === "reinstate") {
    const latest = await prisma.cancelRequest.findFirst({
      where: { planId: plan.id, outcome: "saved" },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) return NextResponse.json({ error: "Nothing to undo." }, { status: 409 });
    const result = await requestCancel(plan.id, {
      source: latest.source === "engineer_logged" ? "engineer_logged" : "customer",
      reason: latest.reason as CancelReason,
      existingRequestId: latest.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, effectiveAt: result.effectiveAt.toISOString() });
  }

  // offer_cheaper — a text from the engineer with a one-tap switch. The
  // customer decides; the engineer can't change their price for them.
  const { plan: full, cheaper } = await cancelContext(plan.id);
  if (cheaper.kind !== "cheaper_plan") {
    return NextResponse.json({ error: "You don't have a cheaper live plan to offer." }, { status: 409 });
  }
  const brand = brandName(full.engineer);
  const link = `${appUrl()}/portal/${full.portalToken}/manage?switch=${cheaper.tier.id}`;
  await sendSms({
    engineerId,
    to: full.customer.phone,
    body: `Hi ${full.customer.firstName}, it's ${brand}. I can move you to my ${cheaper.tier.name} plan at ${pounds(cheaper.tier.priceMonthlyPence)} a month instead, so you keep your plan for less. Switch in one tap: ${link}`,
    messageClass: "TRANSACTIONAL",
    consentBasis: "engineer-initiated",
  });
  const pending = await prisma.cancelRequest.findFirst({
    where: { planId: plan.id, outcome: "cancelled" },
    orderBy: { createdAt: "desc" },
  });
  if (pending && !pending.offer) {
    await prisma.cancelRequest.update({ where: { id: pending.id }, data: { offer: "cheaper_plan" } });
  }
  await track("cancel_offer_sent", { type: "ENGINEER", id: engineerId }, { planId: plan.id, tierId: cheaper.tier.id });
  return NextResponse.json({ ok: true });
}
