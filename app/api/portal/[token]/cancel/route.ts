import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { pausePlan, switchPlanTier } from "@/lib/plan-billing";
import { recordSave, requestCancel, undoCancellation, longDate } from "@/lib/cancel-plan";
import { CANCEL_REASON_CODES, inEngineerArea, pounds, reasonLabel } from "@/lib/retention";

// Retention spec, section 2 — every action on the customer's three cancel
// screens. "cancel" always goes straight through; nothing here can block or
// delay it.
const Reason = z.enum(CANCEL_REASON_CODES);
const Body = z.discriminatedUnion("action", [
  // Keep my plan / No thanks after an offer they didn't take.
  z.object({ action: z.literal("keep"), reason: Reason.optional(), offer: z.string().max(20).nullable().optional() }),
  z.object({ action: z.literal("switch"), reason: Reason.optional(), tierId: z.string().min(1) }),
  z.object({ action: z.literal("pause"), reason: Reason.optional(), months: z.union([z.literal(1), z.literal(2)]) }),
  z.object({
    action: z.literal("move"),
    postcode: z.string().trim().min(5).max(10),
    moveDate: z.iso.date().optional(),
    passportConsent: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("cancel"),
    reason: Reason,
    detail: z.string().trim().max(300).optional(),
    offer: z.string().max(20).nullable().optional(),
    moveDate: z.iso.date().optional(),
    passportConsent: z.boolean().optional(),
  }),
  // Takes back a cancellation before the end date.
  z.object({ action: z.literal("undo") }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Something's missing. Try again." }, { status: 400 });
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true, customer: true },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const body = parsed.data;
  const who = `${plan.customer.firstName} ${plan.customer.lastName}`;

  if (body.action === "cancel") {
    const result = await requestCancel(plan.id, {
      source: "customer",
      reason: body.reason,
      detail: body.detail ?? null,
      offer: body.offer ?? null,
      moveDate: body.moveDate ? new Date(body.moveDate) : null,
      passportConsent: body.passportConsent ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({
      ok: true,
      effectiveAt: result.effectiveAt.toISOString(),
      endedNow: Boolean(result.endedNow),
    });
  }

  if (body.action === "undo") {
    const result = await undoCancellation(plan.id, "customer");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  }

  if (plan.status !== "ACTIVE" && plan.status !== "PAUSED") {
    return NextResponse.json({ error: "This plan isn't active." }, { status: 409 });
  }

  if (body.action === "keep") {
    if (body.reason) await recordSave(plan.id, { reason: body.reason, offer: body.offer ?? null, outcome: "saved" });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "switch") {
    // Only to one of this engineer's live plans that costs less.
    const tier = await prisma.planTier.findFirst({
      where: { id: body.tierId, engineerId: plan.engineerId, status: "LIVE" },
    });
    if (!tier || tier.priceMonthlyPence >= (plan.priceMonthlyPence ?? 0)) {
      return NextResponse.json({ error: "That plan isn't available." }, { status: 400 });
    }
    // Taking the engineer's cheaper offer after cancelling keeps the plan.
    const wasEnding = Boolean(plan.cancelRequestedAt);
    if (wasEnding) {
      const undone = await undoCancellation(plan.id, "customer");
      if (!undone.ok) return NextResponse.json({ error: undone.error }, { status: undone.status });
    }
    try {
      await switchPlanTier(plan.id, tier.id);
    } catch (err) {
      console.error("[cancel-flow] switchPlanTier failed:", err);
      return NextResponse.json({ error: "Couldn't switch your plan. Try again in a minute." }, { status: 502 });
    }
    const latest = wasEnding
      ? await prisma.cancelRequest.findFirst({ where: { planId: plan.id }, orderBy: { createdAt: "desc" } })
      : null;
    if (latest) {
      await prisma.cancelRequest.update({
        where: { id: latest.id },
        data: { outcome: "downgraded", offer: "cheaper_plan", resolvedAt: new Date() },
      });
    } else {
      await recordSave(plan.id, { reason: body.reason ?? "too_expensive", offer: "cheaper_plan", outcome: "downgraded" });
    }
    await notifyEngineer(plan.engineerId, `${who} switched to ${tier.name} (${pounds(tier.priceMonthlyPence)} a month) instead of cancelling.`);
    return NextResponse.json({ ok: true, priceMonthlyPence: tier.priceMonthlyPence, tierName: tier.name });
  }

  if (body.action === "pause") {
    let resumesAt: Date;
    try {
      ({ resumesAt } = await pausePlan(plan.id, body.months));
    } catch (err) {
      console.error("[cancel-flow] pausePlan failed:", err);
      return NextResponse.json({ error: "Couldn't pause your plan. Try again in a minute." }, { status: 502 });
    }
    await recordSave(plan.id, { reason: body.reason ?? "other", offer: "pause", outcome: "paused" });
    await notifyEngineer(plan.engineerId, `${who} paused their plan until ${longDate(resumesAt)} instead of cancelling.`);
    return NextResponse.json({ ok: true, resumesAt: resumesAt.toISOString() });
  }

  // action === "move": keep the plan and tell the engineer the new address.
  const inArea = inEngineerArea({
    newPostcode: body.postcode,
    engineerPostcode: plan.engineer.postcode,
    serviceArea: plan.engineer.serviceArea,
  });
  if (!inArea) {
    return NextResponse.json(
      { error: `${brandName(plan.engineer)} doesn't cover that postcode, so the plan can't move with you.` },
      { status: 409 },
    );
  }
  const moveDate = body.moveDate ? new Date(body.moveDate) : null;
  await recordSave(plan.id, {
    reason: "moving",
    offer: "move_plan",
    outcome: "saved",
    detail: `New postcode ${body.postcode.toUpperCase()}`,
    moveDate,
    passportConsent: body.passportConsent ?? null,
  });
  const when = moveDate ? ` on ${longDate(moveDate)}` : "";
  await notifyEngineer(
    plan.engineerId,
    `${who} is moving to ${body.postcode.toUpperCase()}${when} and wants to keep their plan. Update their address in the app.`,
  );
  await sendPushNotification(plan.engineerId, `${who} is moving`, `Keeping their plan · new postcode ${body.postcode.toUpperCase()}`, {
    url: `/customer/${plan.customerId}`,
  });
  return NextResponse.json({ ok: true, reason: reasonLabel("moving") });
}
