import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activatePlan } from "@/lib/activate";
import { signupMandateConfirmed, subscriptionPaid } from "@/lib/stripe";
import { confirmSignupMandate } from "@/lib/plan-billing";

// Public (token-authenticated) status for the confirmed page. Also actively
// checks the subscription with Stripe so local dev works without a webhook
// tunnel; the webhook remains the production path. Since the cooling-off
// trial (retention spec §1) the plan goes ACTIVE when the Bacs mandate is
// confirmed; nothing is collected until cooling-off ends.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({ where: { signupToken: token } });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (plan.status === "PENDING" && plan.stripeSubscriptionId) {
    try {
      if (plan.stripeCustomerId) {
        const mandate = await signupMandateConfirmed(plan.stripeCustomerId, plan.id);
        if (mandate.confirmed) {
          await confirmSignupMandate(plan.id, {
            paymentMethodId: mandate.paymentMethodId,
            customerId: plan.stripeCustomerId,
          });
          return NextResponse.json({ status: "ACTIVE", portalToken: plan.portalToken });
        }
      }
      // Plans from before the cooling-off trial: ACTIVE on the first payment.
      const result = await subscriptionPaid(plan.stripeSubscriptionId);
      if (result.paid) {
        await activatePlan(plan.id, {
          subscriptionId: plan.stripeSubscriptionId,
          customerId: result.customerId,
        });
        return NextResponse.json({ status: "ACTIVE", portalToken: plan.portalToken });
      }
    } catch (err) {
      console.error("[signup-status] subscription check failed:", err);
    }
  }

  return NextResponse.json({
    status: plan.status,
    ...(plan.status === "PENDING" && plan.mandateStatus === "pending"
      ? { mandate: "pending" }
      : {}),
    ...(plan.status === "ACTIVE" ? { portalToken: plan.portalToken } : {}),
  });
}
