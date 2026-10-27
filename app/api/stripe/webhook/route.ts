import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { recordReferralEarning } from "@/lib/referral";
import { activatePlan } from "@/lib/activate";
import { sendPushNotification } from "@/lib/push";
import { alertIfStripeNeedsMore } from "@/lib/stripe-onboarding";
import { sendFirstPayoutEmail } from "@/lib/account-emails";
import {
  completePaymentRescue,
  completeSignupCheckout,
  confirmSignupMandate,
  recordClearedPayment,
  settleEndedSubscription,
  startPaymentRescue,
  syncPauseFromStripe,
} from "@/lib/plan-billing";
import {
  constructWebhookEvent,
  getConnectAccountStatus,
  getStripe,
  computeApplicationFeePence,
  rescueCheckoutResult,
  signupCheckoutResult,
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
    // Stripe still emits the v1-shaped account.updated event for v2 Accounts
    // (docs.stripe.com/connect/webhooks), but this platform's accounts are
    // created via v2 now (see lib/stripe.ts) — rather than trust whichever
    // fields happen to be populated on that v1-compat payload, treat the
    // event purely as a "something changed" signal and re-fetch current v2
    // status via the connected account id on the event.
    case "account.updated": {
      const accountId = event.account;
      if (!accountId) return;
      const engineer = await prisma.engineer.findFirst({
        where: { stripeAccountId: accountId },
      });
      if (!engineer) return;
      const s = await getConnectAccountStatus(accountId);
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
          accountId,
        });
      }
      await alertIfStripeNeedsMore(engineer, s);
      return;
    }

    // Build Review 3: set the real per-invoice fee (20% rounded down;
    // TradeSura pays Stripe's processing) on every invoice for our plan subscriptions, including the
    // first one — this only works while the invoice is still a draft, before
    // Stripe auto-finalizes it, so a late/already-finalized invoice is
    // logged and left alone rather than failing the webhook.
    case "invoice.created": {
      const invoice = event.data.object as Stripe.Invoice;
      if (!invoice.id) return;
      // Section 1 — the £0 cooling-off trial invoice has no fee to set (and
      // is already paid by the time this arrives).
      if (invoice.total === 0) return;
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
      // Section 1 — the £0 trial invoice "pays" the moment the subscription
      // is created, before any mandate exists. Only real money counts.
      if (invoice.amount_paid <= 0) return;
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
      // Normally already ACTIVE from the mandate (setup_intent.succeeded);
      // this covers plans from before the cooling-off trial.
      await activatePlan(plan.id, {
        subscriptionId,
        customerId: typeof invoice.customer === "string" ? invoice.customer : null,
      });
      // Service start date, paymentsCleared (annual service at 3), and the
      // rescue outcome (payment_rescued) when this clears a failure.
      await recordClearedPayment(plan.id, invoice.amount_paid);
      if (wasFailed) {
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
      // Ruling 4 — the referrer's share of our fee on this collection.
      await recordReferralEarning({
        invoiceId: invoice.id,
        engineerId: plan.engineerId,
        amountPaidPence: invoice.amount_paid,
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
      // Section 3 — the rescue: a one-tap link to a new Direct Debit from the
      // engineer, an installer alert, reminders on day 3 and 7, and the plan
      // only ends if it's still unpaid after the grace period.
      if (plan && invoice.amount_due > 0) {
        await startPaymentRescue(plan.id, invoice.amount_due);
      }
      return;
    }

    // A Bacs mandate was confirmed on one of our SetupIntents: the sign-up
    // (cooling-off starts now; nothing is collected until it ends) or a
    // rescue (new bank details — retry what's owed).
    // Sign-up and the failed-payment rescue both collect the Bacs mandate
    // with embedded Checkout (lib/stripe.ts createSignupCheckout).
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const planId = session.metadata?.planId;
      if (!planId || session.status !== "complete") return;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (session.metadata?.purpose === "signup") {
        const done = await signupCheckoutResult(session);
        if (done) await completeSignupCheckout(planId, { ...done, customerId });
      } else if (session.metadata?.purpose === "rescue") {
        const done = await rescueCheckoutResult(session);
        if (done) await completePaymentRescue(planId, { paymentMethodId: done.paymentMethodId, mandateId: done.mandateId ?? undefined });
      }
      return;
    }

    case "setup_intent.succeeded": {
      const si = event.data.object as Stripe.SetupIntent;
      const planId = si.metadata?.planId;
      const paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
      if (!planId || !paymentMethodId) return;
      if (si.metadata?.purpose === "rescue") {
        await completePaymentRescue(planId, {
          paymentMethodId,
          mandateId: typeof si.mandate === "string" ? si.mandate : si.mandate?.id,
        });
      } else if (si.metadata?.purpose === "signup") {
        await confirmSignupMandate(planId, {
          paymentMethodId,
          customerId: typeof si.customer === "string" ? si.customer : si.customer?.id,
        });
      }
      return;
    }

    // Section 2 — a pause has lifted at Stripe (resumes_at passed, or resumed).
    case "customer.subscription.updated": {
      await syncPauseFromStripe(event.data.object as Stripe.Subscription);
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
      if (!plan) return;
      // A checkout abandoned before the mandate: Stripe cancels the trial at
      // its end. Nothing was ever live, so just detach it — a fresh link
      // starts a new subscription.
      if (plan.status === "PENDING") {
        await prisma.plan.update({
          where: { id: plan.id },
          data: { stripeSubscriptionId: null, mandateStatus: "inactive" },
        });
        return;
      }
      if (plan.status !== "CANCELLED") {
        await prisma.plan.update({
          where: { id: plan.id },
          data: { status: "CANCELLED", cancelledAt: new Date(), mandateStatus: "inactive" },
        });
        await track("plan_cancelled", { type: "SYSTEM" }, {
          planId: plan.id,
          // A scheduled cancellation reaching its end date.
          reason: plan.cancelRequestedAt ? "end_of_paid_period" : "subscription_deleted",
        });
      }
      // Yearly plans: refund the unused whole months; reminders stop.
      await settleEndedSubscription(plan.id, sub);
      return;
    }

    // Part 11 — "Get told when payouts land". A Connect event: needs
    // payout.paid ticked on the Connected-accounts webhook endpoint.
    case "payout.paid": {
      const accountId = event.account;
      if (!accountId) return;
      const engineer = await prisma.engineer.findFirst({
        where: { stripeAccountId: accountId },
        select: { id: true },
      });
      if (!engineer) return;
      const payout = event.data.object as Stripe.Payout;
      await sendPushNotification(
        engineer.id,
        "Payout landed",
        `£${(payout.amount / 100).toFixed(2)} should now be in your bank.`,
        { url: "/payouts" },
      );
      // Build Review 3 §8 — the first Friday payout gets an email (once).
      await sendFirstPayoutEmail(engineer.id, payout.amount);
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
