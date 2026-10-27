import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isLandlordPlan } from "@/lib/clauses";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { createSignupCheckout, ensureRecipientConfiguration, isMissingDestination, publishableKey } from "@/lib/stripe";
import { snapshotTier } from "@/lib/plan-tier";
import { appUrl } from "@/lib/app-url";
import type { Prisma } from "@/lib/generated/prisma/client";

const Body = z.object({
  tierId: z.string().min(1),
  // Section 1 — monthly, or yearly at 12 months for the price of 11.
  billingInterval: z.enum(["month", "year"]).default("month"),
});

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
      billingInterval: parsed.data.billingInterval,
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
    billingInterval: parsed.data.billingInterval,
    channel: "doorstep",
  });

  const brand = brandName(plan.engineer);
  const base = `${appUrl()}/p/${plan.engineer.slug}/signup/${token}`;

  try {
    const sub = await createSignupCheckout({
      engineerAccountId: plan.engineer.stripeAccountId,
      priceMonthlyPence: tier.priceMonthlyPence,
      billingInterval: parsed.data.billingInterval,
      productName: `${brand} — ${tier.name} care plan`,
      customerName: `${plan.customer.firstName} ${plan.customer.lastName}`,
      customerEmail: plan.customer.email ?? undefined,
      customerPhone: plan.customer.phone,
      existingStripeCustomerId: plan.customer.stripeCustomerId,
      planId: plan.id,
      planRef: plan.ref,
      returnUrl: `${base}/confirmed?cs={CHECKOUT_SESSION_ID}`,
    });
    await prisma.plan.update({
      where: { id: plan.id },
      data: {
        stripeCustomerId: sub.customerId,
        mandateStatus: "pending",
        // Provisional: confirmSignupMandate restarts it when the mandate lands.
        coolingOffEndsAt: sub.trialEnd,
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
      // R9 — a Landlord plan asks the customer to confirm the property is let.
      landlord: isLandlordPlan(tier.clauses.map((tc) => tc.clause.code)),
    });
  } catch (err) {
    console.error("[signup] embedded subscription failed:", err);
    if (isMissingDestination(err)) {
      // The engineer's Stripe account can't receive transfers yet (merchant-
      // only v2 account). Add the recipient configuration and mark payments
      // unfinished so the app prompts them — a clear message beats a retry
      // loop that can never succeed.
      await ensureRecipientConfiguration(plan.engineer.stripeAccountId!).catch((e) =>
        console.error("[signup] ensureRecipientConfiguration failed:", e),
      );
      await prisma.engineer.update({
        where: { id: plan.engineer.id },
        data: { stripeChargesEnabled: false },
      });
      return NextResponse.json(
        {
          error: `${plan.engineer.tradingName?.trim() || "This engineer"} needs to finish one step of their payment setup before you can join — nothing has been taken.`,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Could not start the Direct Debit setup — try again in a minute." },
      { status: 502 },
    );
  }
}
