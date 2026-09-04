import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { cancelScheduledSms } from "@/lib/sms";
import { getStripe } from "@/lib/stripe";

// E7b — engineer-initiated pause. Collections stop; the plan can be resumed
// later. Distinct from a customer cancellation.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const plan = await prisma.plan.findFirst({
    where: { customerId: id, engineerId, status: "ACTIVE" },
  });
  if (!plan) return NextResponse.json({ error: "No active plan to pause." }, { status: 404 });

  if (plan.stripeSubscriptionId) {
    try {
      await getStripe().subscriptions.update(plan.stripeSubscriptionId, {
        pause_collection: { behavior: "void" },
      });
    } catch (err) {
      console.error("[pause] Stripe pause failed:", err);
      return NextResponse.json(
        { error: "Could not pause with the payment provider — try again." },
        { status: 502 },
      );
    }
  }

  await prisma.plan.update({ where: { id: plan.id }, data: { status: "PAUSED" } });
  await cancelScheduledSms(`svc:${plan.id}`);
  await track("plan_paused", { type: "ENGINEER", id: engineerId }, {
    planId: plan.id,
    reason: "engineer",
  });
  return NextResponse.json({ ok: true });
}
