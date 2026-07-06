import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { activatePlan } from "@/lib/activate";
import { getBillingRequest } from "@/lib/gocardless";

// Public (token-authenticated) status for the confirmed page. Also actively
// checks the billing request with GoCardless so local dev works without a
// webhook tunnel; the webhook remains the production path.
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({
    where: { signupToken: token },
    include: { engineer: { select: { gcAccessToken: true } } },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (plan.status === "PENDING" && plan.gcBillingRequestId && plan.engineer.gcAccessToken) {
    try {
      const br = await getBillingRequest(plan.engineer.gcAccessToken, plan.gcBillingRequestId);
      if (br.status === "fulfilled") {
        await activatePlan(plan.id, {
          mandateId: br.links.mandate_request_mandate,
          subscriptionId: br.links.subscription_request_subscription,
        });
        return NextResponse.json({ status: "ACTIVE", portalToken: plan.portalToken });
      }
    } catch (err) {
      console.error("[signup-status] billing request check failed:", err);
    }
  }

  return NextResponse.json({
    status: plan.status,
    ...(plan.status === "ACTIVE" ? { portalToken: plan.portalToken } : {}),
  });
}
