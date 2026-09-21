import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { activatePlan } from "@/lib/activate";
import { sendSms, notifyEngineer } from "@/lib/sms";
import {
  constructWebhookEvent,
  accountStatusFrom,
  getStripe,
  computeApplicationFeePence,
} from "@/lib/stripe";
import type { Prisma } from "@/lib/generated/prisma/client";

// One URL for both platform events (checkout, invoices, subscriptions) and
// Connect events (account.updated) — but Stripe requires two separate
// webhook endpoint *objects* registered against it, one per scope, each
// with its own signing secret (docs.stripe.com/connect/webhooks): an
// "account" endpoint (STRIPE_WEBHOOK_SECRET) and a "Connect" endpoint
// (STRIPE_WEBHOOK_SECRET_CONNECT, "Listen to events on Connected accounts").
export async function POST(req: Request) {
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_WEBHOOK_SECRET_CONNECT].filter(
    (s): s is string => Boolean(s),
  );
  if (secrets.length === 0) {
    return NextResponse.json({ error: "webhook secret not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature, secrets);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // Idempotency: Stripe retries webhooks; process each event id once.
  const seen = await prisma.stripeWebhookEvent.findUnique({ where: { id: event.id } });
  if (seen) return NextResponse.json({ received: true, duplicate: true });
  await prisma.stripeWebhookEvent.create({
    data: {
      id: event.id,
      type: event.type,
      payload: event as unknown as Prisma.InputJsonValue,
    },
  });

  try {
    await handleEvent(event);
  } catch (err) {
    console.error(`[stripe-webhook] ${event.type} ${event.id}:`, err);
    // 500 so Stripe retries; the idempotency row is removed so the retry runs.
    await prisma.stripeWebhookEvent.delete({ where: { id: event.id } }).catch(() => {});
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "account.updated": {
      const account = event.data.object as Stripe.Account;
      const engineer = await prisma.engineer.findFirst({
        where: { stripeAccountId: account.id },
      });
      if (!engineer) return;
      const s = accountStatusFrom(account);
      await prisma.engineer.update({
        where: { id: engineer.id },
        data: {
          stripeDetailsSubmitted: s.detailsSubmitted,
          stripeChargesEnabled: s.chargesEnabled,
          stripePayoutsEnabled: s.payoutsEnabled,
        },
      });
      if (s.chargesEnabled && !engineer.stripeChargesEnabled) {
        await track("stripe_onboarded", { type: "ENGINEER", id: engineer.id }, {
          accountId: account.id,
        });
      }
      return;
    }

    // Build Spec v1 S1/Q2: set the real per-invoice fee (20% + ~32p Bacs
    // processing) on every invoice for our plan subscriptions, including the
    // first one — this only works while the invoice is still a draft, before
    // Stripe auto-finalizes it, so a late/already-finalized invoice is
    // logged and left alone rather than failing the webhook.
    case "invoice.created": {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.id) return;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (!subscriptionId) return;
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      if (!sub.metadata?.planId) return; // not one of our destination-charge plans
      const destination = sub.transfer_data?.destination;
      const destinationId = typeof destination === "string" ? destination : destination?.id;
      if (!destinationId) return;
      if (invoice.status !== "draft") {
        console.warn(
          `[stripe-webhook] invoice.created ${invoice.id} already ${invoice.status} — too late to set application_fee_amount`,
        );
        return;
      }
      // Stripe docs (connect/subscriptions#subscription-invoices): a
      // destination-charge invoice update must carry transfer_data alongside
      // application_fee_amount in the same call — it isn't inherited from
      // the subscription automatically.
      await getStripe().invoices.update(invoice.id, {
        application_fee_amount: computeApplicationFeePence(invoice.total),
        transfer_data: { destination: destinationId },
      });
      return;
    }

    // Bacs is a delayed-settlement method: the plan goes ACTIVE only when the
    // first collection actually clears.
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (!subscriptionId) return;
      // checkout.session.completed sets stripeSubscriptionId, but Stripe
      // doesn't guarantee it lands first — fall back to the planId we stamped
      // on the subscription's metadata.
      let plan = await prisma.plan.findFirst({
        where: { stripeSubscriptionId: subscriptionId },
      });
      if (!plan) {
        const sub = await getStripe().subscriptions.retrieve(subscriptionId);
        const planId = sub.metadata?.planId;
        if (planId) plan = await prisma.plan.findUnique({ where: { id: planId } });
      }
      if (!plan) return;
      const wasFailed = Boolean(plan.paymentFailedAt);
      await activatePlan(plan.id, {
        subscriptionId,
        customerId: typeof invoice.customer === "string" ? invoice.customer : null,
      });
      if (wasFailed) {
        await prisma.plan.update({ where: { id: plan.id }, data: { paymentFailedAt: null } });
        await track("payment_recovered", { type: "SYSTEM" }, {
          planId: plan.id,
          engineerId: plan.engineerId,
        });
      }
      await track("payment_confirmed", { type: "SYSTEM" }, {
        planId: plan.id,
        engineerId: plan.engineerId,
        invoiceId: invoice.id,
        amountPence: invoice.amount_paid,
      });
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      const plan = subscriptionId
        ? await prisma.plan.findFirst({
            where: { stripeSubscriptionId: subscriptionId },
            include: { customer: true, engineer: true },
          })
        : null;
      await track("payment_failed", { type: "SYSTEM" }, {
        planId: plan?.id,
        engineerId: plan?.engineerId,
        invoiceId: invoice.id,
      });
      if (plan && !plan.paymentFailedAt) {
        await prisma.plan.update({
          where: { id: plan.id },
          data: { paymentFailedAt: new Date() },
        });
        // S2 — one plain nudge to the customer; Stripe Smart Retries do the rest.
        const brand = brandName(plan.engineer);
        const portal = `${process.env.APP_URL}/portal/${plan.portalToken}`;
        await sendSms({
          engineerId: plan.engineerId,
          to: plan.customer.phone,
          body: `Hi ${plan.customer.firstName} — this month's payment for your care plan with ${brand} didn't go through. Check your details: ${portal}. Nothing to do if you've already fixed it.`,
          messageClass: "TRANSACTIONAL",
          consentBasis: "plan-member-transactional",
        });
        await notifyEngineer(
          plan.engineerId,
          `⚠ ${plan.customer.firstName} ${plan.customer.lastName}'s payment failed — Stripe is retrying automatically. No action needed yet.`,
        );
      }
      return;
    }

    case "customer.subscription.paused": {
      const sub = event.data.object as Stripe.Subscription;
      const plan = await prisma.plan.findFirst({ where: { stripeSubscriptionId: sub.id } });
      if (plan && plan.status === "ACTIVE") {
        await prisma.plan.update({ where: { id: plan.id }, data: { status: "PAUSED" } });
        await track("plan_paused", { type: "SYSTEM" }, { planId: plan.id, reason: "dunning_exhausted" });
      }
      return;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const plan = await prisma.plan.findFirst({ where: { stripeSubscriptionId: sub.id } });
      if (plan && plan.status !== "CANCELLED") {
        await prisma.plan.update({
          where: { id: plan.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), mandateStatus: "inactive" },
        });
        await track("plan_cancelled", { type: "SYSTEM" }, {
          planId: plan.id,
          reason: "subscription_deleted",
        });
      }
      return;
    }

    default:
      return;
  }
}

// Stripe moved the subscription pointer under invoice.parent in recent API
// versions; fall back to the legacy top-level field.
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const parent = (invoice as unknown as {
    parent?: { subscription_details?: { subscription?: string | { id: string } } };
  }).parent;
  const fromParent = parent?.subscription_details?.subscription;
  if (fromParent) return typeof fromParent === "string" ? fromParent : fromParent.id;
  const legacy = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  if (legacy) return typeof legacy === "string" ? legacy : legacy.id;
  return null;
}
