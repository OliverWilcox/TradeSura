import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { createRescueSetupIntent, publishableKey } from "@/lib/stripe";
import { paymentOutstanding } from "@/lib/plan-billing";

// Retention spec §3 — tradesura.com/u/{code}: start a new Bacs Direct Debit
// for a plan with a failed payment. Created on tap, not on page view, so link
// previews in the customer's messaging app don't make SetupIntents.
export async function POST(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const plan = await prisma.plan.findUnique({
    where: { rescueCode: code.toUpperCase() },
    include: { engineer: { select: { stripeAccountId: true } } },
  });
  if (!plan) return NextResponse.json({ error: "This link has expired." }, { status: 404 });
  if (plan.status === "CANCELLED") {
    return NextResponse.json({ error: "This plan has ended." }, { status: 409 });
  }
  if (!paymentOutstanding(plan)) {
    return NextResponse.json({ error: "Your payment is already sorted. Nothing to do." }, { status: 409 });
  }
  if (!plan.stripeCustomerId || !plan.engineer.stripeAccountId) {
    return NextResponse.json({ error: "Couldn't start the Direct Debit setup. Please contact your engineer." }, { status: 409 });
  }
  try {
    const si = await createRescueSetupIntent({
      customerId: plan.stripeCustomerId,
      engineerAccountId: plan.engineer.stripeAccountId,
      planId: plan.id,
    });
    await track("payment_rescue_opened", { type: "CUSTOMER", id: plan.customerId }, {
      planId: plan.id,
      engineerId: plan.engineerId,
    });
    return NextResponse.json({ clientSecret: si.clientSecret, publishableKey: publishableKey() });
  } catch (err) {
    console.error("[rescue] setup intent failed:", err);
    return NextResponse.json({ error: "Couldn't start the Direct Debit setup. Try again in a minute." }, { status: 502 });
  }
}
