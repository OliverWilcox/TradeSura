import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { cancelStripeSubscription } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { cancelScheduledSms, notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";

// One cancellation path for both doors (Build Review 2, ruling 5): the
// customer's manage link, and the engineer ending a plan from the
// customer's page. Either way the Direct Debit stops first, then the plan,
// reminders and confirmation email follow.
export type CancelResult = { ok: true } | { ok: false; status: number; error: string };

export async function cancelPlan(
  planId: string,
  opts: { by: "customer" | "engineer"; reason: string | null },
): Promise<CancelResult> {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    include: { engineer: true, customer: true, tier: true },
  });
  if (!plan) return { ok: false, status: 404, error: "Not found." };
  if (plan.status === "CANCELLED") return { ok: true };

  // Cancel the subscription at Stripe first — the DD must actually stop.
  if (plan.stripeSubscriptionId) {
    try {
      await cancelStripeSubscription(plan.stripeSubscriptionId);
    } catch (err) {
      // Already-cancelled / not-found at Stripe is fine; anything else must
      // not silently pass.
      const code = (err as { code?: string })?.code;
      const status = (err as { statusCode?: number })?.statusCode;
      if (code !== "resource_missing" && status !== 404) {
        console.error("[cancel] Stripe subscription cancel failed:", err);
        return {
          ok: false,
          status: 502,
          error: "Could not cancel with the payment provider — try again in a minute.",
        };
      }
    }
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: { status: "CANCELLED", cancelledAt: new Date(), mandateStatus: "inactive" },
  });
  // A cancelled plan gets no nudges and no service reminders.
  await cancelScheduledSms(`nudge:${plan.id}`);
  await cancelScheduledSms(`svc:${plan.id}`);
  await track(
    "plan_cancelled",
    opts.by === "customer"
      ? { type: "CUSTOMER", id: plan.customerId }
      : { type: "ENGINEER", id: plan.engineerId },
    {
      planId: plan.id,
      ref: plan.ref,
      reason: opts.by === "customer" ? "customer_portal" : "engineer_ended",
      reasonChip: opts.reason,
    },
  );

  const who = `${plan.customer.firstName} ${plan.customer.lastName}`;
  const tierName = plan.tier?.name ?? "care";
  if (opts.by === "customer") {
    await notifyEngineer(
      plan.engineerId,
      `${who} cancelled their ${tierName} plan${opts.reason ? ` (${opts.reason})` : ""}.`,
    );
    await sendPushNotification(plan.engineerId, "Plan cancelled", `${who} cancelled their ${tierName} plan.`, {
      url: `/customer/${plan.customerId}`,
    });
  }

  const brand = brandName(plan.engineer);
  // The cancellation already happened; a mail failure mustn't surface as an
  // error and make anyone think it didn't.
  if (plan.customer.email) {
    const opener =
      opts.by === "customer"
        ? `Your ${plan.tier?.name ?? ""} care plan (${plan.ref}) is cancelled`
        : `${brand} has ended your ${plan.tier?.name ?? ""} care plan (${plan.ref})`;
    await sendEmail({
      to: plan.customer.email,
      subject: `Your ${brand} care plan is cancelled (${plan.ref})`,
      html: `<p>Hi ${plan.customer.firstName},</p>
<p>${opener} and no more payments will be collected by Direct Debit. If a payment was taken within
your 14-day cooling-off period, it will be refunded.</p>
<p>${opts.by === "customer" ? `Changed your mind? ${brand} can send you a new signup link any time.` : `Questions? Reply to ${brand} directly.`}</p>`,
    }).catch((err) => console.error("[cancel] confirmation email failed:", err));
  }
  return { ok: true };
}
