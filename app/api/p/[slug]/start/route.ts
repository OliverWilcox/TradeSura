import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { rejoinFreeMonth } from "@/lib/rejoin-offer";
import { isLandlordPlan } from "@/lib/clauses";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { sendSms } from "@/lib/sms";
import { normaliseUkPhone } from "@/lib/phone";
import { newPlanRef, newToken } from "@/lib/plans";
import { createSignupCheckout, ensureRecipientConfiguration, isMissingDestination, publishableKey } from "@/lib/stripe";
import { snapshotTier } from "@/lib/plan-tier";
import { appUrl } from "@/lib/app-url";
import type { Prisma } from "@/lib/generated/prisma/client";

const Body = z.object({
  tierId: z.string().min(1),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  phone: z.string().min(6).max(20),
  email: z.string().email().max(200).optional().or(z.literal("")),
  channel: z.enum(["web", "demo", "blast", "referral", "website"]).default("web"),
  // Section 8 — the staff engineer handing over their phone ("They're with me").
  soldById: z.string().max(40).optional(),
  // Section 1 — monthly, or yearly at 12 months for the price of 11.
  billingInterval: z.enum(["month", "year"]).default("month"),
  // Retention §9 — arrived from a win-back rejoin link.
  rejoin: z.string().max(64).optional(),
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
      { error: `${engineer.tradingName?.trim() || "This engineer"} hasn't finished their payment setup yet.` },
      { status: 409 },
    );
  }

  const tier = await prisma.planTier.findFirst({
    where: { id: b.tierId, engineerId: engineer.id, status: "LIVE" },
    include: { clauses: { include: { clause: true } } },
  });
  if (!tier) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });

  const phone = normaliseUkPhone(b.phone);
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
  }

  // Only credit a current, verified staff member of this business; anything
  // else is ignored rather than trusted from the page.
  const seller = b.soldById
    ? await prisma.engineer.findFirst({
        where: {
          id: b.soldById,
          ownerId: engineer.id,
          staffRemovedAt: null,
          deletedAt: null,
          gasSafeVerifiedAt: { not: null },
        },
        select: { id: true },
      })
    : null;

  const customer = await prisma.customer.upsert({
    where: { engineerId_phone: { engineerId: engineer.id, phone } },
    update: { email: b.email || undefined },
    create: {
      engineerId: engineer.id,
      firstName: b.firstName,
      lastName: b.lastName,
      phone,
      email: b.email || null,
      source: b.channel === "demo" ? "doorstep" : b.channel === "website" ? "website" : "web",
      addedById: seller?.id ?? null,
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
      soldById: seller?.id ?? null,
      customerId: customer.id,
      tierId: tier.id,
      priceMonthlyPence: tier.priceMonthlyPence,
      billingInterval: b.billingInterval,
      // LAW (plan wording is locked) — freeze the tier as agreed here too.
      agreedTier: snapshotTier(tier) as unknown as Prisma.InputJsonValue,
      signupToken: newToken(),
      portalToken: newToken(),
      linkOpenedAt: new Date(),
    },
  });

  const brand = brandName(engineer);
  const base = `${appUrl()}/p/${engineer.slug}/signup/${plan.signupToken}`;

  await track("tier_selected", { type: "CUSTOMER", id: customer.id }, {
    planId: plan.id,
    tierId: tier.id,
    name: tier.name,
    priceMonthlyPence: tier.priceMonthlyPence,
    billingInterval: b.billingInterval,
    channel: b.channel,
  });

  try {
    const sub = await createSignupCheckout({
      engineerAccountId: engineer.stripeAccountId,
      priceMonthlyPence: tier.priceMonthlyPence,
      billingInterval: b.billingInterval,
      productName: `${brand} — ${tier.name} care plan`,
      customerName: `${b.firstName} ${b.lastName}`,
      customerEmail: b.email || undefined,
      customerPhone: phone,
      existingStripeCustomerId: customer.stripeCustomerId,
      planId: plan.id,
      planRef: plan.ref,
      returnUrl: `${base}/confirmed?cs={CHECKOUT_SESSION_ID}`,
      extraFreeMonths: (await rejoinFreeMonth(engineer.id, b.rejoin)) ? 1 : 0,
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
      signupToken: plan.signupToken,
      // R9 — a Landlord plan asks the customer to confirm the property is let.
      landlord: isLandlordPlan(tier.clauses.map((tc) => tc.clause.code)),
    });
  } catch (err) {
    console.error("[p/start] embedded subscription failed:", err);
    if (isMissingDestination(err)) {
      // The engineer's Stripe account can't receive transfers yet (merchant-
      // only v2 account). Add the recipient configuration and mark payments
      // unfinished so the app prompts them — a clear message beats a retry
      // loop that can never succeed.
      await ensureRecipientConfiguration(engineer.stripeAccountId!).catch((e) =>
        console.error("[p/start] ensureRecipientConfiguration failed:", e),
      );
      await prisma.engineer.update({
        where: { id: engineer.id },
        data: { stripeChargesEnabled: false },
      });
      return NextResponse.json(
        {
          error: `${engineer.tradingName?.trim() || "This engineer"} needs to finish one step of their payment setup before you can join — nothing has been taken.`,
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
