// 30 Oct update §7.9 — "refer a neighbour (you both get a month free)". The
// confirmation page shares the engineer's page with ?nref={plan ref}. A
// neighbour who joins from it gets their first month free (on top of the
// 14-day cooling-off, like the win-back offer), and once their plan goes
// live the referrer's next collection is free: one month's price off, once.
// Both months are the engineer's own customers' payments, so the engineer
// funds them (destination charges: the discount comes off their transfer).
import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";
import { track } from "@/lib/track";

export const NEIGHBOUR_PARAM = "nref";

/** The referring plan, when the ref is a live plan of the same engineer. */
export async function neighbourReferrer(engineerId: string, ref: string | null | undefined) {
  const clean = ref?.trim().toUpperCase();
  if (!clean || clean.length > 40) return null;
  return prisma.plan.findFirst({
    where: { ref: clean, engineerId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { id: true, customerId: true, stripeSubscriptionId: true, priceMonthlyPence: true },
  });
}

export async function neighbourFreeMonth(engineerId: string, ref: string | null | undefined): Promise<boolean> {
  return Boolean(await neighbourReferrer(engineerId, ref));
}

/**
 * Called when a referred plan goes live. Takes one month's price off the
 * referrer's next collection (monthly or yearly), once per referred plan.
 * Best-effort: a failure is logged and tracked as owed, never thrown.
 */
export async function rewardNeighbourReferrer(planId: string): Promise<void> {
  const joined = await prisma.event.findFirst({
    where: { name: "neighbour_referral_joined", meta: { path: ["planId"], equals: planId } },
    select: { meta: true },
  });
  const referrerPlanId = (joined?.meta as { referrerPlanId?: string } | null)?.referrerPlanId;
  if (!referrerPlanId) return;
  const done = await prisma.event.count({
    where: { name: { in: ["neighbour_referral_rewarded", "neighbour_referral_reward_owed"] }, meta: { path: ["planId"], equals: planId } },
  });
  if (done > 0) return;
  const referrer = await prisma.plan.findUnique({
    where: { id: referrerPlanId },
    select: { id: true, status: true, stripeSubscriptionId: true, priceMonthlyPence: true },
  });
  if (!referrer?.stripeSubscriptionId || !referrer.priceMonthlyPence || !["ACTIVE", "PAUSED"].includes(referrer.status)) {
    await track("neighbour_referral_reward_owed", { type: "SYSTEM" }, { planId, referrerPlanId, reason: "referrer_not_live" });
    return;
  }
  try {
    const stripe = getStripe();
    const coupon = await stripe.coupons.create({
      amount_off: referrer.priceMonthlyPence,
      currency: "gbp",
      duration: "once",
      max_redemptions: 1,
      name: "A month free: you referred a neighbour",
      metadata: { planId, referrerPlanId },
    });
    await stripe.subscriptions.update(referrer.stripeSubscriptionId, { discounts: [{ coupon: coupon.id }] });
    await track("neighbour_referral_rewarded", { type: "SYSTEM" }, { planId, referrerPlanId, couponId: coupon.id });
  } catch (err) {
    console.error("[neighbour] referrer free month failed:", err);
    await track("neighbour_referral_reward_owed", { type: "SYSTEM" }, { planId, referrerPlanId, reason: "stripe_error" });
  }
}
