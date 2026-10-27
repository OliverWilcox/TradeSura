import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { cancelScheduledSms, notifyEngineer, sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { sendPushNotification } from "@/lib/push";
import { planDocumentEmailHtml } from "@/lib/plan-doc";
import { activeMonthlyPence } from "@/lib/plans";
import { appUrl } from "@/lib/app-url";
import { FIRST_PAYMENT_LINE, billingIntervalOf, chargePence, priceLine } from "@/lib/billing-interval";
import { attachPlanToPassport } from "@/lib/passport";
import { queueWelcomeTouches } from "@/lib/welcome-touches";
import { firstCustomerPath, firstMemberYearlyPence } from "@/lib/first-member";
import { sendFirstCustomerEmail } from "@/lib/account-emails";

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
      // Set at mandate confirmation (lib/plan-billing.ts confirmSignupMandate),
      // which also moves the first collection to after it.
      coolingOffEndsAt: existing.coolingOffEndsAt ?? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
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
  // Section 4 — the home's passport goes LIVE with the plan.
  await attachPlanToPassport(plan.id);
  // Retention §9 — engineer's welcome, then the Home Passport prompt.
  await queueWelcomeTouches(plan.id).catch((err) => console.error("[activate] welcome touches failed:", err));

  const engineer = await prisma.engineer.findUniqueOrThrow({
    where: { id: plan.engineerId },
    select: { tradingName: true, slug: true },
  });
  const brand = brandName(engineer);
  const portalUrl = `${appUrl()}/portal/${plan.portalToken}`;

  // C3 — welcome message (SMS; email is the plan document below).
  await sendSms({
    engineerId: plan.engineerId,
    to: plan.customer.phone,
    body: `Welcome to ${brand}'s ${plan.tier?.name ?? "care"} plan — ${priceLine(plan.priceMonthlyPence ?? 0, plan.billingInterval)} by Direct Debit. ${FIRST_PAYMENT_LINE} We'll message you when your annual service is due. Manage or cancel anytime: ${portalUrl}`,
    messageClass: "TRANSACTIONAL",
    consentBasis: "plan-member-transactional",
  });

  // A failed email must never strand an activation half-done: the plan is
  // already ACTIVE above, so a throw here would skip the engineer ping and
  // referral check, and Stripe's retry returns early on ACTIVE.
  if (plan.customer.email) {
    try {
      const { subject, html, replyTo } = await planDocumentEmailHtml(plan.id);
      await sendEmail({ to: plan.customer.email, subject, html, replyTo });
    } catch (err) {
      console.error("[activate] plan document email failed:", err);
    }
  }

  // C3 — the sustaining dopamine ping to the engineer.
  const { totalPence, count } = await activeMonthlyPence(plan.engineerId);
  const yearly = Math.round(
    (billingIntervalOf(plan.billingInterval) === "year"
      ? chargePence(plan.priceMonthlyPence ?? 0, "year")
      : (plan.priceMonthlyPence ?? 0) * 12) / 100,
  );
  await notifyEngineer(
    plan.engineerId,
    `🎉 ${plan.customer.firstName} ${plan.customer.lastName} just joined ${plan.tier?.name ?? "your plan"} — £${yearly}/yr added. ${count} plan${count === 1 ? "" : "s"} live, £${Math.round(totalPence / 100)}/mo.`,
  );
  // Review 3 §3 — the very first customer deep-links to the celebration.
  const isFirst = count === 1 && (await prisma.plan.count({ where: { engineerId: plan.engineerId, activatedAt: { not: null } } })) === 1;
  await sendPushNotification(
    plan.engineerId,
    isFirst ? "Your first customer!" : "New plan member",
    `${plan.customer.firstName} ${plan.customer.lastName} joined ${plan.tier?.name ?? "your plan"} — £${yearly}/yr added.`,
    {
      url: isFirst
        ? firstCustomerPath({
            planId: plan.id,
            customerFirstName: plan.customer.firstName,
            planName: plan.tier?.name ?? "your plan",
            yearlyPence: firstMemberYearlyPence(plan.priceMonthlyPence ?? 0, plan.billingInterval),
          })
        : `/customer/${plan.customerId}`,
    },
  );
  // Build Review 3 §8 — the first customer is an account email too.
  if (isFirst) {
    await sendFirstCustomerEmail(
      plan.engineerId,
      `${plan.customer.firstName} ${plan.customer.lastName}`,
      plan.tier?.name ?? "your plan",
      firstMemberYearlyPence(plan.priceMonthlyPence ?? 0, plan.billingInterval),
    ).catch((err) => console.error("[activate] first customer email failed:", err));
  }
  // Section 8 — the staff engineer who signed them up hears too, with no £.
  if (plan.soldById) {
    await sendPushNotification(
      plan.soldById,
      "Customer signed up",
      `${plan.customer.firstName} ${plan.customer.lastName} is now on ${plan.tier?.name ?? "a plan"} — nice work.`,
      { url: `/customer/${plan.customerId}` },
    );
  }

  return plan;
}
