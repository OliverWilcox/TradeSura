import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { createEmbeddedSubscription, publishableKey } from "@/lib/stripe";
import { snapshotTier } from "@/lib/plan-tier";
import type { Prisma } from "@/lib/generated/prisma/client";

const Body = z.object({ tierId: z.string().min(1) });

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });

  const plan = await prisma.plan.findUnique({
    where: { signupToken: token },
    include: { engineer: true, customer: true },
  });
  if (!plan) return NextResponse.json({ error: "This link has expired." }, { status: 404 });
  if (plan.status !== "PENDING") {
    return NextResponse.json({ error: "This plan is already set up." }, { status: 409 });
  }

  const tier = await prisma.planTier.findFirst({
    where: { id: parsed.data.tierId, engineerId: plan.engineerId, status: "LIVE" },
    include: { clauses: { include: { clause: true } } },
  });
  if (!tier) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });

  if (!plan.engineer.stripeAccountId || !plan.engineer.stripeChargesEnabled) {
    return NextResponse.json(
      {
        error: `${plan.engineer.tradingName?.trim() || "Your engineer"} hasn't finished their payment setup yet — let them know.`,
      },
      { status: 409 },
    );
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: {
      tierId: tier.id,
      priceMonthlyPence: tier.priceMonthlyPence,
      // LAW (plan wording is locked) — freeze the tier as agreed; a later
      // edit to the live tier must not rewrite this customer's plan document.
      agreedTier: snapshotTier(tier) as unknown as Prisma.InputJsonValue,
    },
  });
  await track("tier_selected", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    tierId: tier.id,
    name: tier.name,
    priceMonthlyPence: tier.priceMonthlyPence,
    channel: "doorstep",
  });

  const brand = brandName(plan.engineer);
  const base = `${process.env.APP_URL}/p/${plan.engineer.slug}/signup/${token}`;

  try {
    const sub = await createEmbeddedSubscription({
      engineerAccountId: plan.engineer.stripeAccountId,
      priceMonthlyPence: tier.priceMonthlyPence,
      productName: `${brand} — ${tier.name} care plan`,
      customerName: `${plan.customer.firstName} ${plan.customer.lastName}`,
      customerEmail: plan.customer.email ?? undefined,
      customerPhone: plan.customer.phone,
      existingStripeCustomerId: plan.customer.stripeCustomerId,
      planId: plan.id,
      planRef: plan.ref,
    });
    await prisma.plan.update({
      where: { id: plan.id },
      data: {
        stripeSubscriptionId: sub.subscriptionId,
        stripeCustomerId: sub.customerId,
        mandateStatus: "pending",
      },
    });
    await prisma.customer.update({
      where: { id: plan.customerId },
      data: { stripeCustomerId: sub.customerId },
    });
    await track("checkout_started", { type: "CUSTOMER", id: plan.customerId }, {
      planId: plan.id,
      channel: "doorstep",
    });
    return NextResponse.json({
      clientSecret: sub.clientSecret,
      publishableKey: publishableKey(),
      confirmedUrl: `${base}/confirmed`,
      signupToken: token,
    });
  } catch (err) {
    console.error("[signup] embedded subscription failed:", err);
    return NextResponse.json(
      { error: "Could not start the Direct Debit setup — try again in a minute." },
      { status: 502 },
    );
  }
}
