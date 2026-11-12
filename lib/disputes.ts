import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { track } from "@/lib/track";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { sendEmail } from "@/lib/email";
import { SUPPORT_EMAIL, escapeHtml } from "@/lib/email-layout";
import { pounds } from "@/lib/retention";

// Matt, 30 Oct §9.6: reversed payments and disputes come out of the
// installer's balance, never our fee. With Bacs a reversed payment is a
// Direct Debit indemnity claim, and Stripe reports it as a dispute on the
// collection's charge (charge.dispute.created / .closed on the platform
// endpoint). Stripe takes the money from TradeSura's balance, so here the
// engineer's share of that collection (the transfer it made) is reversed
// back, and handed back again if the claim is overturned.
//
// A destination charge transfers the whole collection to the engineer and
// Stripe takes our 20% back from them as the application fee, so reversing
// the transfer takes the whole claim from the engineer while TradeSura keeps
// its fee, as Matt's rule says. Stripe's own dispute fee (£5 for Bacs) is
// the engineer's too (Matt, 12 Nov): it's pulled from their Stripe balance
// with an account debit. That can't come off the transfer, which only ever
// held the collection itself. Stripe keeps the fee even when a claim is
// overturned, so it isn't handed back.

function chargeIdOf(dispute: Stripe.Dispute): string {
  return typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
}

/** The plan a charge paid for: its payment intent's invoice, then the subscription on our Plan row. */
async function planForCharge(charge: Stripe.Charge) {
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return null;
  const stripe = getStripe();
  const payments = await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 });
  const inv = payments.data[0]?.invoice;
  const invoiceId = typeof inv === "string" ? inv : inv?.id;
  if (!invoiceId) return null;
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const sub = invoice.parent?.subscription_details?.subscription;
  const subscriptionId = typeof sub === "string" ? sub : sub?.id;
  if (!subscriptionId) return null;
  return prisma.plan.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    include: { customer: { select: { firstName: true, lastName: true } } },
  });
}

/** Stripe's fee for this dispute, from the balance transactions it raised. */
export function disputeFeePence(dispute: Stripe.Dispute): number {
  return (dispute.balance_transactions ?? []).reduce((sum, bt) => sum + Math.max(0, bt.fee ?? 0), 0);
}

async function tellTeam(subject: string, lines: string[]) {
  await sendEmail({
    to: process.env.DISPUTE_ALERT_EMAIL || SUPPORT_EMAIL,
    subject,
    html: lines.filter(Boolean).map((l) => `<p>${escapeHtml(l)}</p>`).join(""),
  }).catch((err) => console.error("[disputes] team email failed:", err));
}

export async function handleDisputeCreated(dispute: Stripe.Dispute) {
  if (await prisma.planDispute.findUnique({ where: { stripeDisputeId: dispute.id } })) return;
  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(chargeIdOf(dispute));
  const plan = await planForCharge(charge);

  // The engineer's share of this collection, reversed back, up to what's
  // still on the transfer (never more than the claim).
  let reversedPence = 0;
  let reversalId: string | null = null;
  let engineerAccount: string | null = null;
  const transferId = typeof charge.transfer === "string" ? charge.transfer : charge.transfer?.id;
  if (transferId) {
    const transfer = await stripe.transfers.retrieve(transferId);
    engineerAccount = typeof transfer.destination === "string" ? transfer.destination : (transfer.destination?.id ?? null);
    const amount = Math.min(dispute.amount, transfer.amount - transfer.amount_reversed);
    if (amount > 0) {
      const reversal = await stripe.transfers.createReversal(
        transferId,
        { amount, metadata: { disputeId: dispute.id, kind: "dispute" } },
        { idempotencyKey: `dispute-reverse:${dispute.id}` },
      );
      reversedPence = amount;
      reversalId = reversal.id;
    }
  }

  // Stripe's dispute fee, debited from the engineer's balance. A refusal
  // (usually not enough available yet) mustn't fail the webhook: the team is
  // asked to recover it instead.
  const feePence = disputeFeePence(dispute);
  let feeDebitId: string | null = null;
  let feeDebitFailed = false;
  if (feePence > 0 && engineerAccount) {
    try {
      const platform = await stripe.accounts.retrieveCurrent();
      const debit = await stripe.transfers.create(
        { amount: feePence, currency: dispute.currency, destination: platform.id, metadata: { disputeId: dispute.id, kind: "dispute_fee" } },
        { stripeAccount: engineerAccount, idempotencyKey: `dispute-fee:${dispute.id}` },
      );
      feeDebitId = debit.id;
    } catch (err) {
      console.error(`[disputes] fee debit for ${dispute.id} failed:`, err);
      feeDebitFailed = true;
    }
  }
  const takenPence = reversedPence + (feeDebitId ? feePence : 0);

  await prisma.planDispute.create({
    data: {
      stripeDisputeId: dispute.id,
      chargeId: charge.id,
      planId: plan?.id ?? null,
      engineerId: plan?.engineerId ?? null,
      amountPence: dispute.amount,
      reason: dispute.reason ?? null,
      status: dispute.status,
      reversedPence,
      reversalId,
      feePence,
      feeDebitId,
    },
  });
  await track("payment_disputed", { type: "SYSTEM" }, {
    planId: plan?.id,
    engineerId: plan?.engineerId,
    disputeId: dispute.id,
    amountPence: dispute.amount,
    reversedPence,
    feePence: feeDebitId ? feePence : 0,
    reason: dispute.reason,
  });

  const customer = plan ? `${plan.customer.firstName} ${plan.customer.lastName}` : null;
  if (plan) {
    const line = `${plan.customer.firstName} ${plan.customer.lastName} has claimed back a ${pounds(dispute.amount)} Direct Debit payment through their bank. ${takenPence > 0 ? `The ${pounds(takenPence)}${feeDebitId ? ` (including Stripe's ${pounds(feePence)} claim fee)` : ""} comes back out of your next payout. ` : ""}If the claim is overturned, the payment comes back to you.`;
    await sendPushNotification(plan.engineerId, "A payment was claimed back", line, { planId: plan.id }).catch(() => {});
    await notifyEngineer(plan.engineerId, `TradeSura: ${line}`).catch(() => {});
  }
  await tellTeam(`Payment claimed back: ${pounds(dispute.amount)}${customer ? `, ${customer}` : ""}`, [
    `A ${pounds(dispute.amount)} collection was claimed back or disputed (${dispute.reason ?? "no reason given"}).`,
    plan ? `Plan ${plan.ref ?? plan.id}, ${customer}.` : `No plan found for charge ${charge.id}.`,
    reversedPence > 0 ? `${pounds(reversedPence)} has been taken back from the engineer (our fee is kept).` : "Nothing was reversed from the engineer.",
    feeDebitId
      ? `Stripe's ${pounds(feePence)} dispute fee was taken from the engineer's Stripe balance.`
      : feeDebitFailed
        ? `ACTION: Stripe refused taking the ${pounds(feePence)} dispute fee from the engineer's balance (usually not enough available yet). Recover it from them by hand.`
        : feePence > 0
          ? `Stripe's ${pounds(feePence)} dispute fee couldn't be matched to an engineer account.`
          : "",
    `Stripe dispute ${dispute.id}.`,
  ]);
}

export async function handleDisputeClosed(dispute: Stripe.Dispute) {
  const row = await prisma.planDispute.findUnique({ where: { stripeDisputeId: dispute.id } });
  if (!row || row.closedAt) return;
  const now = new Date();
  // Won: Stripe gives the money back to TradeSura, so the engineer's share
  // goes back to them.
  let returnedTransferId: string | null = null;
  let handBackFailed = false;
  if (dispute.status === "won" && row.reversedPence > 0) {
    // Back to whoever the collection went to: the original transfer's
    // destination (the engineer's account, even with no plan on record).
    const stripe = getStripe();
    const charge = await stripe.charges.retrieve(row.chargeId);
    const transferId = typeof charge.transfer === "string" ? charge.transfer : charge.transfer?.id;
    const original = transferId ? await stripe.transfers.retrieve(transferId) : null;
    const destination = original ? (typeof original.destination === "string" ? original.destination : original.destination?.id) : null;
    if (destination) {
      // The returned money may not be available on our balance yet; a refusal
      // mustn't fail the webhook, so the team is asked to hand it back.
      try {
        const transfer = await stripe.transfers.create(
          { amount: row.reversedPence, currency: dispute.currency, destination, metadata: { disputeId: dispute.id, kind: "dispute_won" } },
          { idempotencyKey: `dispute-return:${dispute.id}` },
        );
        returnedTransferId = transfer.id;
      } catch (err) {
        console.error(`[disputes] hand-back for ${dispute.id} failed:`, err);
        handBackFailed = true;
      }
    }
  }
  await prisma.planDispute.update({
    where: { id: row.id },
    data: { status: dispute.status, closedAt: now, returnedTransferId },
  });
  await track("payment_dispute_closed", { type: "SYSTEM" }, {
    planId: row.planId,
    engineerId: row.engineerId,
    disputeId: dispute.id,
    outcome: dispute.status,
    returnedPence: returnedTransferId ? row.reversedPence : 0,
  });
  if (row.engineerId && returnedTransferId) {
    const line = `Good news: a ${pounds(row.amountPence)} payment claim was overturned, so the ${pounds(row.reversedPence)} is back in your next payout.`;
    await sendPushNotification(row.engineerId, "Claim overturned", line, { planId: row.planId }).catch(() => {});
    await notifyEngineer(row.engineerId, `TradeSura: ${line}`).catch(() => {});
  }
  await tellTeam(`Payment claim ${dispute.status}: ${pounds(row.amountPence)}`, [
    `Stripe dispute ${dispute.id} closed as ${dispute.status}.`,
    returnedTransferId
      ? `${pounds(row.reversedPence)} was handed back to the engineer.`
      : handBackFailed
        ? `ACTION: Stripe refused the ${pounds(row.reversedPence)} hand-back to the engineer (usually the money isn't available on our balance yet). Send it to them from the Stripe dashboard.`
        : "Nothing was handed back to the engineer.",
  ]);
}
