// Retention spec sections 1 (plan rules) and 3 (failed payment rescue): the
// billing operations every other part of the app calls. Stripe stays the
// source of truth for money; the Plan row mirrors what the customer sees.
//
// Stripe params verified against the installed stripe@22.6.0 types:
// SubscriptionUpdateParams.cancel_at_period_end / cancel_at /
// pause_collection{behavior,resumes_at} / proration_behavior,
// RefundCreateParams.reverse_transfer / refund_application_fee,
// InvoicePayParams.payment_method / mandate.
import crypto from "node:crypto";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { getStripe } from "@/lib/stripe";
import { snapshotTier } from "@/lib/plan-tier";
import { cancelScheduledSms, nextAllowedSendTime, notifyEngineer, sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { sendPushNotification } from "@/lib/push";
import { appUrl } from "@/lib/app-url";
import { activatePlan } from "@/lib/activate";
import {
  ANNUAL_SERVICE_AFTER_PAYMENTS,
  addMonths,
  billingIntervalOf,
  chargePence,
  coolingOffEnd,
  poundsLabel,
  unusedYearlyMonths,
  usedYearlyMonths,
  yearlyRefundPence,
} from "@/lib/billing-interval";
import type { Prisma } from "@/lib/generated/prisma/client";

export * from "@/lib/billing-interval";

const DAY_MS = 24 * 60 * 60 * 1000;
// Section 3 — the plan only ends if a payment is still unpaid this long after
// it failed, with reminders on the days below in between.
export const RESCUE_GRACE_DAYS = 14;
export const RESCUE_REMINDER_DAYS = [3, 7] as const;

// ---------------------------------------------------------------------------
// Rules (pure)
// ---------------------------------------------------------------------------

// The annual service can only be booked once the 3rd monthly payment clears.
// A yearly payment covers the whole year up front, so one cleared payment is
// enough there.
export function annualServiceUnlocked(plan: {
  paymentsCleared: number;
  billingInterval?: string | null;
}): boolean {
  if (billingIntervalOf(plan.billingInterval) === "year") return plan.paymentsCleared >= 1;
  return plan.paymentsCleared >= ANNUAL_SERVICE_AFTER_PAYMENTS;
}

// A failed collection that hasn't been recovered yet. Service booking and
// reminders hold while this is true.
export function paymentOutstanding(plan: { paymentFailedAt: Date | null }): boolean {
  return plan.paymentFailedAt !== null && plan.paymentFailedAt !== undefined;
}

// Benefits run from the service start date (the first cleared payment after
// cooling-off), and stop while paused or while a payment is outstanding.
export function benefitsActive(
  plan: { status: string; serviceStartsAt: Date | null; paymentFailedAt: Date | null },
  now = new Date(),
): boolean {
  return (
    plan.status === "ACTIVE" &&
    plan.serviceStartsAt !== null &&
    plan.serviceStartsAt <= now &&
    !paymentOutstanding(plan)
  );
}

// ---------------------------------------------------------------------------
// Stripe helpers
// ---------------------------------------------------------------------------

function periodOf(sub: Stripe.Subscription): { start: Date; end: Date } | null {
  // Billing periods live on the subscription item in current API versions.
  const item = sub.items.data[0];
  if (!item) return null;
  return { start: new Date(item.current_period_start * 1000), end: new Date(item.current_period_end * 1000) };
}

const unix = (d: Date) => Math.floor(d.getTime() / 1000);

async function loadPlan(planId: string) {
  return prisma.plan.findUniqueOrThrow({ where: { id: planId } });
}

// The most recent payment Stripe actually collected on this subscription, for
// refunds. Destination charges: the refund reverses the engineer's transfer
// and our fee in proportion, so nobody keeps money for unused months.
async function latestPaidPayment(subscriptionId: string): Promise<{
  invoiceId: string;
  paymentIntentId: string;
  amountPaid: number;
  amountRefunded: number;
} | null> {
  const stripe = getStripe();
  const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: "paid", limit: 5 });
  const invoice = invoices.data.find((i) => i.amount_paid > 0);
  if (!invoice?.id) return null;
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 5 });
  const paid = payments.data.find((p) => p.status === "paid" && p.payment.payment_intent);
  const pi = paid?.payment.payment_intent;
  const paymentIntentId = typeof pi === "string" ? pi : pi?.id;
  if (!paymentIntentId) return null;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = intent.latest_charge && typeof intent.latest_charge !== "string" ? intent.latest_charge : null;
  return {
    invoiceId: invoice.id,
    paymentIntentId,
    amountPaid: invoice.amount_paid,
    amountRefunded: charge?.amount_refunded ?? 0,
  };
}

async function refundPayment(paymentIntentId: string, amount: number, key: string) {
  if (amount <= 0) return;
  await getStripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      amount,
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: { kind: key.split(":")[0] },
    },
    { idempotencyKey: key },
  );
}

async function endNow(planId: string, now: Date) {
  await prisma.plan.update({
    where: { id: planId },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      mandateStatus: "inactive",
      cancelRequestedAt: now,
      cancelEffectiveAt: now,
    },
  });
  await cancelScheduledSms(`nudge:${planId}`);
  await cancelScheduledSms(`svc:${planId}`);
  await cancelScheduledSms(`rescue:${planId}`);
}

// ---------------------------------------------------------------------------
// Cancel / undo
// ---------------------------------------------------------------------------

// Section 1 — cancellation takes effect at the end of the current paid month;
// no part-month refunds after cooling-off. During cooling-off it ends at once
// with nothing taken (and anything that somehow was taken goes back). Yearly
// plans end at the end of the month in progress and the unused whole months
// are refunded pro rata when the subscription actually ends (see
// settleEndedSubscription), so "undo" before then costs nothing.
// Does not create CancelRequest rows (lib/cancel-plan.ts does).
export async function cancelAtPeriodEnd(planId: string): Promise<{ effectiveAt: Date }> {
  const plan = await loadPlan(planId);
  const now = new Date();
  if (plan.status === "CANCELLED") return { effectiveAt: plan.cancelEffectiveAt ?? plan.cancelledAt ?? now };

  if (!plan.stripeSubscriptionId) {
    await endNow(plan.id, now);
    return { effectiveAt: now };
  }

  const stripe = getStripe();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(plan.stripeSubscriptionId);
  } catch (err) {
    if ((err as { code?: string }).code !== "resource_missing") throw err;
    await endNow(plan.id, now);
    return { effectiveAt: now };
  }
  if (sub.status === "canceled" || sub.status === "incomplete_expired") {
    await endNow(plan.id, now);
    return { effectiveAt: now };
  }

  const inCoolingOff =
    sub.status === "trialing" || (plan.coolingOffEndsAt !== null && plan.coolingOffEndsAt > now);
  if (inCoolingOff) {
    // Plans from before the cooling-off trial were charged at once: within
    // cooling-off that payment comes back in full.
    const paid = await latestPaidPayment(sub.id);
    if (paid && paid.amountRefunded === 0) {
      await refundPayment(paid.paymentIntentId, paid.amountPaid, `cooling-off-refund:${paid.invoiceId}`);
    }
    await stripe.subscriptions.cancel(sub.id);
    await endNow(plan.id, now);
    return { effectiveAt: now };
  }

  let effectiveAt: Date;
  const period = periodOf(sub);
  if (billingIntervalOf(plan.billingInterval) === "year" && period) {
    effectiveAt = addMonths(period.start, usedYearlyMonths(period.start, now));
    if (effectiveAt > period.end) effectiveAt = period.end;
    const updated = await stripe.subscriptions.update(sub.id, {
      cancel_at: unix(effectiveAt),
      proration_behavior: "none",
    });
    if (updated.cancel_at) effectiveAt = new Date(updated.cancel_at * 1000);
  } else {
    const updated = await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    effectiveAt = updated.cancel_at
      ? new Date(updated.cancel_at * 1000)
      : (periodOf(updated)?.end ?? period?.end ?? now);
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: { cancelRequestedAt: plan.cancelRequestedAt ?? now, cancelEffectiveAt: effectiveAt },
  });
  return { effectiveAt };
}

// The "save" in one tap: billing carries on as if nothing happened.
export async function undoCancel(planId: string): Promise<void> {
  const plan = await loadPlan(planId);
  if (plan.status === "CANCELLED") throw new Error("This plan has already ended.");
  if (plan.stripeSubscriptionId) {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(plan.stripeSubscriptionId);
    if (sub.status === "canceled") throw new Error("This plan has already ended.");
    if (sub.cancel_at_period_end) {
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
    } else if (sub.cancel_at) {
      await stripe.subscriptions.update(sub.id, { cancel_at: "", proration_behavior: "none" });
    }
  }
  await prisma.plan.update({
    where: { id: plan.id },
    data: { cancelRequestedAt: null, cancelEffectiveAt: null },
  });
}

// customer.subscription.deleted: a yearly plan ending early gets its unused
// whole months back, pro rata of what was paid. Safe to replay — skips a
// payment that already has a refund on it.
export async function settleEndedSubscription(planId: string, sub: Stripe.Subscription): Promise<void> {
  const plan = await loadPlan(planId);
  await cancelScheduledSms(`svc:${plan.id}`);
  await cancelScheduledSms(`rescue:${plan.id}`);
  if (billingIntervalOf(plan.billingInterval) !== "year") return;
  const period = periodOf(sub);
  if (!period) return;
  const endedAt = sub.ended_at ? new Date(sub.ended_at * 1000) : new Date();
  if (endedAt >= period.end) return;
  const paid = await latestPaidPayment(sub.id);
  if (!paid || paid.amountRefunded > 0) return;
  const months = unusedYearlyMonths(period.start, endedAt);
  const amount = yearlyRefundPence(paid.amountPaid, months);
  await refundPayment(paid.paymentIntentId, amount, `yearly-refund:${paid.invoiceId}`);
  await track("yearly_refund", { type: "SYSTEM" }, { planId: plan.id, unusedMonths: months, amountPence: amount });
}

// ---------------------------------------------------------------------------
// Pause / resume / switch
// ---------------------------------------------------------------------------

// Pause = no collections and no benefits; Stripe restarts collection itself at
// resumes_at, and the subscription.updated webhook (or the daily job) flips
// the plan back to ACTIVE.
export async function pausePlan(planId: string, months: 1 | 2): Promise<{ resumesAt: Date }> {
  const plan = await loadPlan(planId);
  if (plan.status !== "ACTIVE" && plan.status !== "PAUSED") throw new Error("Only a live plan can be paused.");
  const resumesAt = addMonths(new Date(), months);
  if (plan.stripeSubscriptionId) {
    await getStripe().subscriptions.update(plan.stripeSubscriptionId, {
      pause_collection: { behavior: "void", resumes_at: unix(resumesAt) },
    });
  }
  await prisma.plan.update({ where: { id: plan.id }, data: { status: "PAUSED", pausedUntil: resumesAt } });
  await cancelScheduledSms(`svc:${plan.id}`);
  await track("plan_paused", { type: "SYSTEM" }, { planId: plan.id, months, resumesAt: resumesAt.toISOString() });
  return { resumesAt };
}

export async function resumePlan(planId: string): Promise<void> {
  const plan = await loadPlan(planId);
  if (plan.status !== "PAUSED") return;
  if (plan.stripeSubscriptionId) {
    await getStripe().subscriptions.update(plan.stripeSubscriptionId, { pause_collection: "" });
  }
  await markResumed(plan.id);
}

async function markResumed(planId: string) {
  await prisma.plan.update({ where: { id: planId }, data: { status: "ACTIVE", pausedUntil: null } });
  await track("plan_resumed", { type: "SYSTEM" }, { planId });
}

// Daily job backstop: a pause whose date has passed is over (Stripe has
// already resumed collection on its own).
export async function resumeDuePausedPlans(now = new Date()): Promise<number> {
  const due = await prisma.plan.findMany({
    where: { status: "PAUSED", pausedUntil: { lte: now } },
    select: { id: true },
  });
  for (const p of due) await markResumed(p.id);
  return due.length;
}

// customer.subscription.updated: our pause has lifted at Stripe.
export async function syncPauseFromStripe(sub: Stripe.Subscription): Promise<void> {
  const plan = await prisma.plan.findFirst({ where: { stripeSubscriptionId: sub.id } });
  if (!plan || plan.status !== "PAUSED" || !plan.pausedUntil) return;
  if (!sub.pause_collection) await markResumed(plan.id);
}

// Move to another LIVE tier of the same engineer (usually the cheaper one
// offered in the cancel flow). The new price applies from the next
// collection — no proration — and the agreed contract is re-snapshotted.
export async function switchPlanTier(planId: string, tierId: string): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId }, include: { engineer: true } });
  const tier = await prisma.planTier.findFirst({
    where: { id: tierId, engineerId: plan.engineerId, status: "LIVE" },
    include: { clauses: { include: { clause: true } } },
  });
  if (!tier) throw new Error("That plan isn't available.");

  if (plan.stripeSubscriptionId) {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(plan.stripeSubscriptionId);
    const item = sub.items.data[0];
    if (!item) throw new Error(`Subscription ${sub.id} has no items`);
    const interval = billingIntervalOf(plan.billingInterval);
    const price = await stripe.prices.create({
      currency: "gbp",
      unit_amount: chargePence(tier.priceMonthlyPence, interval),
      recurring: { interval },
      product_data: { name: `${brandName(plan.engineer)} — ${tier.name} care plan` },
    });
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: item.id, price: price.id }],
      proration_behavior: "none",
    });
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: {
      tierId: tier.id,
      priceMonthlyPence: tier.priceMonthlyPence,
      agreedTier: snapshotTier(tier) as unknown as Prisma.InputJsonValue,
    },
  });
  await track("plan_switched", { type: "SYSTEM" }, {
    planId: plan.id,
    fromTierId: plan.tierId,
    toTierId: tier.id,
    priceMonthlyPence: tier.priceMonthlyPence,
  });
}

// ---------------------------------------------------------------------------
// Sign-up (cooling-off) and cleared payments
// ---------------------------------------------------------------------------

// The customer confirmed their Bacs mandate (setup_intent.succeeded, or the
// confirmed page's poll). Cooling-off runs 14 days from now: the trial is
// pushed out to match if the customer took a while between choosing a plan
// and finishing, so the first collection is never inside cooling-off.
export async function confirmSignupMandate(
  planId: string,
  ids: { paymentMethodId: string | null; customerId?: string | null },
): Promise<void> {
  const plan = await loadPlan(planId);
  if (plan.status !== "PENDING") return;
  const ends = coolingOffEnd(new Date());
  if (plan.stripeSubscriptionId) {
    const stripe = getStripe();
    const sub = await stripe.subscriptions.retrieve(plan.stripeSubscriptionId);
    const update: Stripe.SubscriptionUpdateParams = {};
    if (ids.paymentMethodId && !sub.default_payment_method) update.default_payment_method = ids.paymentMethodId;
    if (sub.status === "trialing" && sub.trial_end && sub.trial_end < unix(ends)) {
      update.trial_end = unix(ends);
      update.proration_behavior = "none";
    }
    if (Object.keys(update).length) await stripe.subscriptions.update(sub.id, update);
  }
  await prisma.plan.update({ where: { id: plan.id }, data: { coolingOffEndsAt: ends } });
  await activatePlan(plan.id, {
    subscriptionId: plan.stripeSubscriptionId ?? undefined,
    customerId: ids.customerId ?? null,
  });
}

// invoice.paid with money in it. The first one after cooling-off is the
// service start date; the count unlocks the annual service at 3. A payment
// clearing after a failure is a rescue.
export async function recordClearedPayment(planId: string, amountPaidPence: number): Promise<void> {
  if (amountPaidPence <= 0) return;
  const plan = await loadPlan(planId);
  const now = new Date();
  await prisma.plan.update({
    where: { id: plan.id },
    data: {
      paymentsCleared: { increment: 1 },
      serviceStartsAt: plan.serviceStartsAt ?? now,
      ...(plan.paymentFailedAt ? { paymentFailedAt: null, paymentRecoveredAt: now } : {}),
    },
  });
  if (plan.paymentFailedAt) {
    await cancelScheduledSms(`rescue:${plan.id}`);
    await track("payment_rescued", { type: "SYSTEM" }, {
      planId: plan.id,
      engineerId: plan.engineerId,
      amountPence: amountPaidPence,
      daysToRescue: Math.round((now.getTime() - plan.paymentFailedAt.getTime()) / DAY_MS),
    });
    await sendPushNotification(
      plan.engineerId,
      "Payment back on track",
      "A customer's missed payment has now cleared.",
      { url: `/customer/${plan.customerId}` },
    );
  }
}

// ---------------------------------------------------------------------------
// Section 3 — failed payment rescue
// ---------------------------------------------------------------------------

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O, 1/I/L

export function rescueCodeCandidate(length = 4): string {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

async function newRescueCode(): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const code = rescueCodeCandidate(attempt < 10 ? 4 : 6);
    if (!(await prisma.plan.findUnique({ where: { rescueCode: code }, select: { id: true } }))) return code;
  }
}

export function rescueUrl(code: string): string {
  return `${appUrl()}/u/${code}`;
}

// +447700900123 → 07700 900123
export function ukPhoneDisplay(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const national = e164.startsWith("+44") ? `0${e164.slice(3)}` : e164;
  return national.length === 11 ? `${national.slice(0, 5)} ${national.slice(5)}` : national;
}

function engineerFirstName(e: { firstName: string | null; gasSafeName: string | null }, brand: string): string {
  return e.firstName?.trim() || e.gasSafeName?.trim().split(/\s+/)[0] || brand;
}

export function rescueTextBody(opts: {
  customerFirstName: string;
  amountPence: number;
  brand: string;
  link: string;
  engineerFirstName: string;
  engineerPhone: string | null;
}): string {
  const call = opts.engineerPhone
    ? ` Any questions, just call ${opts.engineerFirstName} on ${opts.engineerPhone}.`
    : "";
  return (
    `Hi ${opts.customerFirstName}, your ${poundsLabel(opts.amountPence)} payment to ${opts.brand} didn't go through. ` +
    `Update your bank details in one tap and your plan carries on as normal: ${opts.link} ` +
    `Your annual service and plan benefits are waiting for you.${call}`
  );
}

// invoice.payment_failed on a live plan. Once per failure: Stripe's own
// retries failing again don't re-text the customer.
export async function startPaymentRescue(planId: string, amountPence: number): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: planId },
    include: { customer: true, engineer: true },
  });
  if (plan.status !== "ACTIVE" && plan.status !== "PAUSED") return;
  if (plan.paymentFailedAt) return;

  const now = new Date();
  const code = plan.rescueCode ?? (await newRescueCode());
  await prisma.plan.update({
    where: { id: plan.id },
    data: { paymentFailedAt: now, paymentRecoveredAt: null, rescueCode: code },
  });
  // Service booking holds while a payment is outstanding.
  await cancelScheduledSms(`svc:${plan.id}`);

  const brand = brandName(plan.engineer);
  const link = rescueUrl(code);
  const first = engineerFirstName(plan.engineer, brand);
  const phone = ukPhoneDisplay(plan.engineer.phone);
  const who = `${plan.customer.firstName} ${plan.customer.lastName}`;

  // Transactional, but still not at 3am: hold overnight failures to 08:00.
  await sendSms({
    engineerId: plan.engineerId,
    to: plan.customer.phone,
    body: rescueTextBody({
      customerFirstName: plan.customer.firstName,
      amountPence,
      brand,
      link,
      engineerFirstName: first,
      engineerPhone: phone,
    }),
    messageClass: "TRANSACTIONAL",
    consentBasis: "plan-member-transactional",
    sendAfter: nextAllowedSendTime(now),
    cancelKey: `rescue:${plan.id}:0`,
  });

  if (plan.customer.email) {
    const b = escapeHtml(brand);
    await sendEmail({
      to: plan.customer.email,
      replyTo: plan.engineer.email,
      subject: `Your payment to ${brand} didn't go through`,
      html: `<p>Hi ${escapeHtml(plan.customer.firstName)},</p>
<p>Your ${poundsLabel(amountPence)} payment to ${b} didn't go through. Update your bank details in one
tap and your plan carries on as normal:</p>
<p><a href="${link}">Set up my Direct Debit again</a></p>
<p>Your annual service and plan benefits are waiting for you.${
        phone ? ` Any questions, just call ${escapeHtml(first)} on ${phone}.` : " Any questions, just reply to this email."
      }</p>
<p>${b}</p>`,
    }).catch((err) => console.error("[rescue] email failed:", err));
  }

  // Grace period reminders, from the engineer, on day 3 and day 7.
  const endsOn = new Date(now.getTime() + RESCUE_GRACE_DAYS * DAY_MS).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
  });
  for (const day of RESCUE_REMINDER_DAYS) {
    const sendAfter = new Date(now.getTime() + day * DAY_MS);
    sendAfter.setHours(10, 0, 0, 0);
    await sendSms({
      engineerId: plan.engineerId,
      to: plan.customer.phone,
      body:
        day === RESCUE_REMINDER_DAYS[RESCUE_REMINDER_DAYS.length - 1]
          ? `Hi ${plan.customer.firstName}, ${brand} here. Your ${poundsLabel(amountPence)} plan payment is still outstanding. Set up your Direct Debit again in one tap so your plan doesn't end on ${endsOn}: ${link}`
          : `Hi ${plan.customer.firstName}, ${brand} here. Just a reminder that your ${poundsLabel(amountPence)} plan payment didn't go through. Update your bank details in one tap: ${link}`,
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
      sendAfter,
      cancelKey: `rescue:${plan.id}:${day}`,
    });
  }

  await notifyEngineer(
    plan.engineerId,
    `${who}'s ${poundsLabel(amountPence)} payment didn't go through. We've texted them a link to update their bank details. A quick call from you helps.${
      plan.customer.phone ? ` ${ukPhoneDisplay(plan.customer.phone)}` : ""
    }`,
  );
  await sendPushNotification(
    plan.engineerId,
    "Payment didn't go through",
    `${who}'s ${poundsLabel(amountPence)} payment failed. We've sent them a link to fix it.`,
    { url: `/customer/${plan.customerId}` },
  );
  await track("payment_rescue_started", { type: "SYSTEM" }, {
    planId: plan.id,
    engineerId: plan.engineerId,
    amountPence,
  });
}

// The customer set up a new mandate on /u/{code}: make it the plan's payment
// method and retry what's owed straight away (Bacs takes ~3 working days to
// clear; invoice.paid then completes the rescue). Idempotent.
export async function completePaymentRescue(
  planId: string,
  ids: { paymentMethodId: string; mandateId?: string | null },
): Promise<{ retried: number }> {
  const plan = await loadPlan(planId);
  if (!plan.stripeSubscriptionId) return { retried: 0 };
  const stripe = getStripe();
  await stripe.subscriptions.update(plan.stripeSubscriptionId, { default_payment_method: ids.paymentMethodId });
  const open = await stripe.invoices.list({ subscription: plan.stripeSubscriptionId, status: "open", limit: 5 });
  let retried = 0;
  for (const invoice of open.data) {
    if (!invoice.id) continue;
    try {
      await stripe.invoices.pay(invoice.id, {
        payment_method: ids.paymentMethodId,
        ...(ids.mandateId ? { mandate: ids.mandateId } : {}),
      });
      retried++;
    } catch (err) {
      // A Bacs retry usually returns processing, not an error; a real error
      // here is logged and left to Stripe's own retry schedule.
      console.error(`[rescue] retry of ${invoice.id} failed:`, err);
    }
  }
  await track("payment_rescue_details_updated", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    engineerId: plan.engineerId,
    retried,
  });
  return { retried };
}

// Is a retry for this subscription already on its way through Bacs? Then the
// grace period mustn't end the plan under it.
async function retryInFlight(subscriptionId: string): Promise<boolean> {
  const stripe = getStripe();
  const open = await stripe.invoices.list({ subscription: subscriptionId, status: "open", limit: 5 });
  if (open.data.length === 0) return true; // nothing owed any more; invoice.paid will land
  for (const invoice of open.data) {
    if (!invoice.id) continue;
    const payments = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 5 });
    for (const p of payments.data) {
      const pi = p.payment.payment_intent;
      const id = typeof pi === "string" ? pi : pi?.id;
      if (!id) continue;
      const intent = await stripe.paymentIntents.retrieve(id);
      if (intent.status === "processing") return true;
    }
  }
  return false;
}

// Daily job: a payment still unpaid after the grace period ends the plan.
export async function endUnpaidPlans(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - RESCUE_GRACE_DAYS * DAY_MS);
  const plans = await prisma.plan.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] }, paymentFailedAt: { lte: cutoff } },
    include: { customer: true, engineer: true },
  });
  let ended = 0;
  for (const plan of plans) {
    if (plan.stripeSubscriptionId) {
      try {
        if (await retryInFlight(plan.stripeSubscriptionId)) continue;
        await getStripe().subscriptions.cancel(plan.stripeSubscriptionId);
      } catch (err) {
        if ((err as { code?: string }).code !== "resource_missing") {
          console.error(`[rescue] ending ${plan.id} failed:`, err);
          continue;
        }
      }
    }
    await endNow(plan.id, now);
    ended++;
    const brand = brandName(plan.engineer);
    const who = `${plan.customer.firstName} ${plan.customer.lastName}`;
    await track("payment_lost", { type: "SYSTEM" }, {
      planId: plan.id,
      engineerId: plan.engineerId,
      failedAt: plan.paymentFailedAt?.toISOString(),
    });
    await track("plan_cancelled", { type: "SYSTEM" }, { planId: plan.id, ref: plan.ref, reason: "payment_lost" });
    await sendSms({
      engineerId: plan.engineerId,
      to: plan.customer.phone,
      body: `Hi ${plan.customer.firstName}, ${brand} here. We couldn't collect your plan payment, so your plan has now ended and no more payments will be taken. If you'd like to rejoin, just get in touch.`,
      messageClass: "TRANSACTIONAL",
      consentBasis: "plan-member-transactional",
      sendAfter: nextAllowedSendTime(now),
    });
    await notifyEngineer(plan.engineerId, `${who}'s plan has ended: their payment was still unpaid after ${RESCUE_GRACE_DAYS} days.`);
    await sendPushNotification(plan.engineerId, "Plan ended", `${who}'s plan ended after an unpaid payment.`, {
      url: `/customer/${plan.customerId}`,
    });
  }
  return ended;
}
