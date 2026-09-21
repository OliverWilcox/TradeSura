import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { notifyEngineer } from "@/lib/sms";
import { payReferralBounty, stripeConfigured } from "@/lib/stripe";

export const REFERRAL_BOUNTY_PENCE = 5000;
// Build Guide v2 Part 14 RULED — "the £50 pays when the invited engineer's
// first plan goes live," closing the old five-plans question. Kept as a
// named config value, per Part 19's pattern, rather than inlining a literal
// 1 at every call site.
export const REFERRAL_REQUIRED_PLANS = 1;

// Build Guide v2 Part 14 — "The referral ladder per invitee: Signed up →
// Verified → Plan live → £50 paid."
export type ReferralStage = "signed_up" | "verified" | "plan_live" | "paid";

export function referralStage(opts: {
  verified: boolean;
  activePlans: number;
  bountyPaid: boolean;
}): ReferralStage {
  if (opts.bountyPaid) return "paid";
  if (opts.activePlans > 0) return "plan_live"; // bounty pays synchronously on activation
  if (opts.verified) return "verified";
  return "signed_up";
}

// Called after a plan goes live: if this engineer was referred and has now hit
// the plan threshold, pay the referrer's flat bounty as a platform-funded
// Stripe transfer. Idempotent via referralBountyPaidAt.
export async function checkReferralBounty(inviteeEngineerId: string) {
  const invitee = await prisma.engineer.findUnique({
    where: { id: inviteeEngineerId },
    include: { referrer: true },
  });
  if (!invitee?.referrerId || !invitee.referrer || invitee.referralBountyPaidAt) return;

  const activePlans = await prisma.plan.count({
    where: { engineerId: inviteeEngineerId, status: "ACTIVE" },
  });
  if (activePlans < REFERRAL_REQUIRED_PLANS) return;

  // Anti-gaming: same-person / same-household referrals are voided by an admin
  // flag (not modelled here) — this pays automatically for the clean case.
  const paidAt = new Date();
  await prisma.engineer.update({
    where: { id: inviteeEngineerId },
    data: { referralBountyPaidAt: paidAt },
  });

  const ref = `${invitee.referrer.slug}<-${invitee.slug}`;
  if (
    stripeConfigured() &&
    invitee.referrer.stripeAccountId &&
    invitee.referrer.stripePayoutsEnabled
  ) {
    try {
      await payReferralBounty(invitee.referrer.stripeAccountId, REFERRAL_BOUNTY_PENCE, ref);
    } catch (err) {
      console.error("[referral] bounty transfer failed:", err);
    }
  }

  await track("referral_activated", { type: "SYSTEM" }, {
    referrerId: invitee.referrerId,
    inviteeId: inviteeEngineerId,
    bountyPence: REFERRAL_BOUNTY_PENCE,
  });
  await notifyEngineer(
    invitee.referrerId,
    `💷 ${invitee.tradingName?.trim() || "Your referral"}'s first plan just went live — your £${REFERRAL_BOUNTY_PENCE / 100} is in your next payout.`,
  );
}
