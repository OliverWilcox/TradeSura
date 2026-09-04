import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { sendSms } from "@/lib/sms";
import { normaliseUkPhone } from "@/lib/phone";
import { newPlanRef, newToken } from "@/lib/plans";
import { createEmbeddedSubscription, publishableKey } from "@/lib/stripe";

const Body = z.object({
  tierId: z.string().min(1),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().min(6).max(20),
  email: z.string().email().max(200).optional().or(z.literal("")),
  channel: z.enum(["web", "demo", "blast", "referral"]).default("web"),
});

// Public plan page (C1) → embedded checkout. No pre-created plan and no
// doorstep token: creates the Customer + Plan cold, then returns the Stripe
// confirmation secret for the inline Payment Element (customer never leaves
// the white-label page).
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check your details and try again." }, { status: 400 });
  }
  const b = parsed.data;

  const engineer = await prisma.engineer.findUnique({ where: { slug } });
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!engineer.stripeAccountId || !engineer.stripeChargesEnabled) {
    return NextResponse.json(
      { error: `${engineer.tradingName ?? "This engineer"} hasn't finished their payment setup yet.` },
      { status: 409 },
    );
  }

  const tier = await prisma.planTier.findFirst({
    where: { id: b.tierId, engineerId: engineer.id, archived: false },
  });
  if (!tier) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });

  const phone = normaliseUkPhone(b.phone);
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
  }

  const customer = await prisma.customer.upsert({
    where: { engineerId_phone: { engineerId: engineer.id, phone } },
    update: { email: b.email || undefined },
    create: {
      engineerId: engineer.id,
      firstName: b.firstName,
      lastName: b.lastName,
      phone,
      email: b.email || null,
      source: b.channel === "demo" ? "doorstep" : "web",
    },
  });

  const active = await prisma.plan.findFirst({
    where: { customerId: customer.id, status: "ACTIVE" },
  });
  if (active) {
    return NextResponse.json(
      { error: "You're already on a plan with this engineer.", portalToken: active.portalToken },
      { status: 409 },
    );
  }

  const plan = await prisma.plan.create({
    data: {
      ref: await newPlanRef(),
      engineerId: engineer.id,
      customerId: customer.id,
      tierId: tier.id,
      priceMonthlyPence: tier.priceMonthlyPence,
      signupToken: newToken(),
      portalToken: newToken(),
      linkOpenedAt: new Date(),
    },
  });

  const brand = engineer.tradingName ?? engineer.slug;
  const base = `${process.env.APP_URL}/p/${engineer.slug}/signup/${plan.signupToken}`;

  await track("tier_selected", { type: "CUSTOMER", id: customer.id }, {
    planId: plan.id,
    tierId: tier.id,
    name: tier.name,
    priceMonthlyPence: tier.priceMonthlyPence,
    channel: b.channel,
  });

  try {
    const sub = await createEmbeddedSubscription({
      engineerAccountId: engineer.stripeAccountId,
      priceMonthlyPence: tier.priceMonthlyPence,
      productName: `${brand} — ${tier.name} care plan`,
      customerName: `${b.firstName} ${b.lastName}`,
      customerEmail: b.email || undefined,
      customerPhone: phone,
      existingStripeCustomerId: customer.stripeCustomerId,
      planId: plan.id,
      planRef: plan.ref,
    });
    await prisma.plan.update({
      where: { id: plan.id },
      data: { stripeSubscriptionId: sub.subscriptionId, stripeCustomerId: sub.customerId, mandateStatus: "pending" },
    });
    await prisma.customer.update({
      where: { id: customer.id },
      data: { stripeCustomerId: sub.customerId },
    });
    await track("checkout_started", { type: "CUSTOMER", id: customer.id }, {
      planId: plan.id,
      channel: b.channel,
    });

    // Abandon nudges: that evening + 3 days later. Cancelled on activation.
    const now = new Date();
    const evening = new Date(now);
    evening.setHours(18, 30, 0, 0);
    if (evening <= now) evening.setTime(now.getTime() + 30 * 60 * 1000);
    const day3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    day3.setHours(10, 0, 0, 0);
    const nudge = `Your quote for ${brand}'s care plan is still open — finish signing up: ${base}`;
    for (const sendAfter of [evening, day3]) {
      await sendSms({
        engineerId: engineer.id,
        to: phone,
        body: nudge,
        messageClass: "MARKETING",
        sendAfter,
        cancelKey: `nudge:${plan.id}`,
      });
    }

    return NextResponse.json({
      clientSecret: sub.clientSecret,
      publishableKey: publishableKey(),
      confirmedUrl: `${base}/confirmed`,
    });
  } catch (err) {
    console.error("[p/start] embedded subscription failed:", err);
    return NextResponse.json(
      { error: "Could not start the Direct Debit setup — try again in a minute." },
      { status: 502 },
    );
  }
}
