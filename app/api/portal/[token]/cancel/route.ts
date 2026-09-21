import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { cancelStripeSubscription } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { cancelScheduledSms, notifyEngineer } from "@/lib/sms";

const Body = z.object({ reason: z.string().max(40).nullable().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const reason = Body.safeParse(await req.json().catch(() => ({}))).data?.reason ?? null;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true, customer: true, tier: true },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (plan.status === "CANCELLED") return NextResponse.json({ ok: true });

  // Cancel the subscription at Stripe first — the DD must actually stop.
  if (plan.stripeSubscriptionId) {
    try {
      await cancelStripeSubscription(plan.stripeSubscriptionId);
    } catch (err) {
      // Already-cancelled / not-found at Stripe is fine; anything else must
      // not silently pass.
      const code = (err as { code?: string; statusCode?: number })?.code;
      const status = (err as { statusCode?: number })?.statusCode;
      if (code !== "resource_missing" && status !== 404) {
        console.error("[cancel] Stripe subscription cancel failed:", err);
        return NextResponse.json(
          { error: "Could not cancel with the payment provider — try again in a minute." },
          { status: 502 },
        );
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
  await track("plan_cancelled", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    ref: plan.ref,
    reason: "customer_portal",
    reasonChip: reason,
  });
  await notifyEngineer(
    plan.engineerId,
    `${plan.customer.firstName} ${plan.customer.lastName} cancelled their ${plan.tier?.name ?? "care"} plan${reason ? ` (${reason})` : ""}.`,
  );

  const brand = brandName(plan.engineer);
  if (plan.customer.email) {
    await sendEmail({
      to: plan.customer.email,
      subject: `Your ${brand} care plan is cancelled (${plan.ref})`,
      html: `<p>Hi ${plan.customer.firstName},</p>
<p>Your ${plan.tier?.name ?? ""} care plan (${plan.ref}) is cancelled and no more payments will be
collected by Direct Debit. If a payment was taken within your 14-day cooling-off period, it will
be refunded.</p>
<p>Changed your mind? ${brand} can send you a new signup link any time.</p>`,
    });
  }
  return NextResponse.json({ ok: true });
}
