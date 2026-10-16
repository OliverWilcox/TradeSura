import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { payReferralCommission, stripeConfigured } from "@/lib/stripe";
import { TRADESURA_FEE_RATE } from "@/lib/clauses";

// Build Review 2, ruling 4 — every installer is an affiliate. They earn a
// share of TradeSura's fee on plans sold by engineers they bring in: 25% for
// that engineer's first 12 months, then 10% for life. One level only — nobody
// earns on their referrals' referrals. Replaces the flat £50 bounty.
export const REFERRAL_FIRST_YEAR_PERCENT = 25;
export const REFERRAL_LIFETIME_PERCENT = 10;
export const REFERRAL_FIRST_YEAR_MONTHS = 12;

export function referralRatePercent(inviteeJoinedAt: Date, at: Date = new Date()): number {
  const cutoff = new Date(inviteeJoinedAt);
  cutoff.setMonth(cutoff.getMonth() + REFERRAL_FIRST_YEAR_MONTHS);
  return at < cutoff ? REFERRAL_FIRST_YEAR_PERCENT : REFERRAL_LIFETIME_PERCENT;
}

// Commission is on TradeSura's 20%, not the Bacs processing pass-through.
export function referralCommission(invoicePaidPence: number, ratePercent: number) {
  const feePence = Math.round(invoicePaidPence * TRADESURA_FEE_RATE);
  return { feePence, amountPence: Math.round((feePence * ratePercent) / 100) };
}

// Build Guide v2 Part 14's ladder, re-ended for the affiliate model:
// Signed up → Verified → Plan live → Earning.
export type ReferralStage = "signed_up" | "verified" | "plan_live" | "earning";

export function referralStage(opts: {
  verified: boolean;
  activePlans: number;
  earnedPence: number;
}): ReferralStage {
  if (opts.earnedPence > 0) return "earning";
  if (opts.activePlans > 0) return "plan_live";
  if (opts.verified) return "verified";
  return "signed_up";
}

// Called from invoice.paid for every collected customer invoice. If the
// selling engineer was referred, record the referrer's commission and send it
// as a platform-funded transfer. Idempotent on invoiceId: a replayed webhook
// finds the row and stops, and the transfer carries the same idempotency key.
export async function recordReferralEarning(opts: {
  invoiceId: string;
  engineerId: string;
  amountPaidPence: number;
}) {
  if (opts.amountPaidPence <= 0) return;
  const invitee = await prisma.engineer.findUnique({
    where: { id: opts.engineerId },
    include: { referrer: true },
  });
  if (!invitee?.referrerId || !invitee.referrer) return;

  const ratePercent = referralRatePercent(invitee.createdAt);
  const { feePence, amountPence } = referralCommission(opts.amountPaidPence, ratePercent);
  if (amountPence <= 0) return;

  const isFirst =
    (await prisma.referralEarning.count({ where: { inviteeId: invitee.id } })) === 0;
  let earning;
  try {
    earning = await prisma.referralEarning.create({
      data: {
        referrerId: invitee.referrerId,
        inviteeId: invitee.id,
        invoiceId: opts.invoiceId,
        feePence,
        ratePercent,
        amountPence,
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return; // already recorded
    throw err;
  }

  const ref = `${invitee.referrer.slug}<-${invitee.slug}`;
  if (stripeConfigured() && invitee.referrer.stripeAccountId && invitee.referrer.stripePayoutsEnabled) {
    try {
      const transfer = await payReferralCommission(
        invitee.referrer.stripeAccountId,
        amountPence,
        ref,
        opts.invoiceId,
      );
      await prisma.referralEarning.update({
        where: { id: earning.id },
        data: { transferId: transfer.id },
      });
    } catch (err) {
      // Left with transferId null so it shows as owed in the admin ledger.
      console.error("[referral] commission transfer failed:", err);
    }
  }

  await track("referral_commission_earned", { type: "SYSTEM" }, {
    referrerId: invitee.referrerId,
    inviteeId: invitee.id,
    invoiceId: opts.invoiceId,
    ratePercent,
    amountPence,
  });

  // One ping when an invitee first starts earning for them, not one per
  // collection — that would be a text every month per customer.
  if (isFirst) {
    const name = invitee.tradingName?.trim() || "Your referral";
    const body = `💷 ${name}'s first customer just paid — you now earn ${ratePercent}% of our fee on every plan they sell.`;
    await notifyEngineer(invitee.referrerId, body);
    await sendPushNotification(invitee.referrerId, "You're earning from a referral", body, {
      url: "/referral",
    });
  }
}
