import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { cancelGcSubscription } from "@/lib/gocardless";
import { sendEmail } from "@/lib/email";
import { cancelScheduledSms } from "@/lib/sms";

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true, customer: true, tier: true },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (plan.status === "CANCELLED") return NextResponse.json({ ok: true });

  // Cancel the subscription at GoCardless first — the DD must actually stop.
  if (plan.gcSubscriptionId && plan.engineer.gcAccessToken) {
    try {
      await cancelGcSubscription(plan.engineer.gcAccessToken, plan.gcSubscriptionId);
    } catch (err) {
      // Already-cancelled at GC is fine; anything else must not silently pass.
      const msg = err instanceof Error ? err.message : "";
      if (!/cancelled|422|404/.test(msg)) {
        console.error("[cancel] GC subscription cancel failed:", err);
        return NextResponse.json(
          { error: "Could not cancel with the payment provider — try again in a minute." },
          { status: 502 },
        );
      }
    }
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  // A cancelled plan must not receive "your quote is still open" nudges.
  await cancelScheduledSms(`nudge:${plan.id}`);
  await track("plan_cancelled", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    ref: plan.ref,
    reason: "customer_portal",
  });

  const brand = plan.engineer.tradingName ?? plan.engineer.slug;
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
