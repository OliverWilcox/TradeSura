import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { activatePlan } from "@/lib/activate";
import { getBillingRequest, verifyWebhookSignature, type GcEvent } from "@/lib/gocardless";
import type { Prisma } from "@/lib/generated/prisma/client";

export async function POST(req: Request) {
  const secret = process.env.GC_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });

  const rawBody = await req.text();
  const signature = req.headers.get("webhook-signature") ?? "";
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 498 });
  }

  const { events } = JSON.parse(rawBody) as { events: GcEvent[] };
  let processed = 0;

  for (const event of events) {
    // Idempotency: GoCardless retries webhooks; process each event once.
    const seen = await prisma.gcWebhookEvent.findUnique({ where: { id: event.id } });
    if (seen) continue;
    await prisma.gcWebhookEvent.create({
      data: {
        id: event.id,
        resourceType: event.resource_type,
        action: event.action,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      await handleEvent(event);
      processed++;
    } catch (err) {
      // Log and continue — a failing event must not block the batch.
      console.error(`[gc-webhook] ${event.resource_type}.${event.action} ${event.id}:`, err);
    }
  }
  return NextResponse.json({ processed });
}

async function handleEvent(event: GcEvent) {
  if (event.resource_type === "billing_requests" && event.action === "fulfilled") {
    const brId = event.links.billing_request;
    if (!brId) return;
    const plan = await prisma.plan.findFirst({
      where: { gcBillingRequestId: brId },
      include: { engineer: true },
    });
    if (!plan || !plan.engineer.gcAccessToken) return;
    const br = await getBillingRequest(plan.engineer.gcAccessToken, brId);
    await activatePlan(plan.id, {
      mandateId: br.links.mandate_request_mandate,
      subscriptionId: br.links.subscription_request_subscription,
    });
    return;
  }

  if (event.resource_type === "mandates" && ["cancelled", "failed", "expired"].includes(event.action)) {
    const plan = await prisma.plan.findFirst({
      where: { gcMandateId: event.links.mandate ?? "" },
    });
    if (plan && plan.status !== "CANCELLED") {
      await prisma.plan.update({
        where: { id: plan.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await track("plan_cancelled", { type: "SYSTEM" }, {
        planId: plan.id,
        reason: `mandate_${event.action}`,
      });
    }
    return;
  }

  if (event.resource_type === "payments" && ["confirmed", "failed"].includes(event.action)) {
    const plan = event.links.subscription
      ? await prisma.plan.findFirst({ where: { gcSubscriptionId: event.links.subscription } })
      : null;
    await track(
      event.action === "confirmed" ? "payment_confirmed" : "payment_failed",
      { type: "SYSTEM" },
      { paymentId: event.links.payment, planId: plan?.id, engineerId: plan?.engineerId },
    );
    return;
  }

  if (event.resource_type === "subscriptions" && event.action === "cancelled") {
    const plan = await prisma.plan.findFirst({
      where: { gcSubscriptionId: event.links.subscription ?? "" },
    });
    if (plan && plan.status !== "CANCELLED") {
      await prisma.plan.update({
        where: { id: plan.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await track("plan_cancelled", { type: "SYSTEM" }, {
        planId: plan.id,
        reason: "subscription_cancelled",
      });
    }
  }
}
