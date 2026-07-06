import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { cancelScheduledSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { planDocumentEmailHtml } from "@/lib/plan-doc";

// Idempotent: safe to call again if GoCardless retries the webhook.
export async function activatePlan(
  planId: string,
  gcIds: { mandateId?: string; subscriptionId?: string },
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
      gcMandateId: gcIds.mandateId ?? existing.gcMandateId,
      gcSubscriptionId: gcIds.subscriptionId ?? existing.gcSubscriptionId,
    },
    include: { customer: true },
  });

  await track("mandate_active", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    ref: plan.ref,
    mandateId: plan.gcMandateId,
    subscriptionId: plan.gcSubscriptionId,
  });

  await cancelScheduledSms(`nudge:${plan.id}`);

  if (plan.customer.email) {
    const { subject, html } = await planDocumentEmailHtml(plan.id);
    await sendEmail({ to: plan.customer.email, subject, html });
  }
  return plan;
}
