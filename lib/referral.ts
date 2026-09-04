import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { notifyEngineer } from "@/lib/sms";
import { payReferralBounty, stripeConfigured } from "@/lib/stripe";

export const REFERRAL_BOUNTY_PENCE = 5000;
export const REFERRAL_REQUIRED_PLANS = 5;

export type ReferralStage = "invited" | "signed_up" | "building" | "paid";

export function referralStage(activePlans: number, bountyPaid: boolean): ReferralStage {
  if (bountyPaid) return "paid";
  if (activePlans >= REFERRAL_REQUIRED_PLANS) return "building"; // paid on next check
  return activePlans > 0 ? "building" : "signed_up";
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
    `💷 ${invitee.tradingName ?? "Your referral"} just hit ${REFERRAL_REQUIRED_PLANS} live plans — your £${REFERRAL_BOUNTY_PENCE / 100} is in your next payout.`,
  );
}
