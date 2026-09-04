import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { cancelScheduledSms, notifyEngineer, sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { planDocumentEmailHtml } from "@/lib/plan-doc";
import { activeMonthlyPence } from "@/lib/plans";
import { checkReferralBounty } from "@/lib/referral";

// Idempotent: safe to call again if Stripe retries the webhook, or if the
// confirmed-page poll and the webhook both land.
export async function activatePlan(
  planId: string,
  stripeIds: { subscriptionId?: string; customerId?: string | null },
) {
  const existing = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });
  if (existing.status === "ACTIVE") return existing;

  const now = new Date();
  const plan = await prisma.plan.update({
    where: { id: planId },
    data: {
      status: "ACTIVE",
      activatedAt: now,
      coolingOffEndsAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
      mandateStatus: "active",
      stripeSubscriptionId: stripeIds.subscriptionId ?? existing.stripeSubscriptionId,
      stripeCustomerId: stripeIds.customerId ?? existing.stripeCustomerId,
    },
    include: { customer: true, tier: true },
  });

  await track("mandate_active", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    ref: plan.ref,
    subscriptionId: plan.stripeSubscriptionId,
  });
  await track("plan_live", { type: "SYSTEM" }, {
    planId: plan.id,
    engineerId: plan.engineerId,
    priceMonthlyPence: plan.priceMonthlyPence,
  });

  await cancelScheduledSms(`nudge:${plan.id}`);

  const engineer = await prisma.engineer.findUniqueOrThrow({
    where: { id: plan.engineerId },
    select: { tradingName: true, slug: true },
  });
  const brand = engineer.tradingName ?? engineer.slug;
  const portalUrl = `${process.env.APP_URL}/portal/${plan.portalToken}`;

  // C3 — welcome message (SMS; email is the plan document below).
  await sendSms({
    engineerId: plan.engineerId,
    to: plan.customer.phone,
    body: `Welcome to ${brand}'s ${plan.tier?.name ?? "care"} plan — £${((plan.priceMonthlyPence ?? 0) / 100).toFixed(2)}/mo by Direct Debit. We'll message you when your annual service is due. Manage or cancel anytime: ${portalUrl}`,
    messageClass: "TRANSACTIONAL",
    consentBasis: "plan-member-transactional",
  });

  if (plan.customer.email) {
    const { subject, html } = await planDocumentEmailHtml(plan.id);
    await sendEmail({ to: plan.customer.email, subject, html });
  }

  // C3 — the sustaining dopamine ping to the engineer.
  const { totalPence, count } = await activeMonthlyPence(plan.engineerId);
  const yearly = Math.round(((plan.priceMonthlyPence ?? 0) * 12) / 100);
  await notifyEngineer(
    plan.engineerId,
    `🎉 ${plan.customer.firstName} ${plan.customer.lastName} just joined ${plan.tier?.name ?? "your plan"} — £${yearly}/yr added. ${count} plan${count === 1 ? "" : "s"} live, £${Math.round(totalPence / 100)}/mo.`,
  );

  // E10 — pay the referrer's bounty if this engineer just hit the threshold.
  await checkReferralBounty(plan.engineerId);

  return plan;
}
