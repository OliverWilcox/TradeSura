import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { appFeePence } from "@/lib/clauses";
import {
  createBillingRequestFlow,
  createBillingRequestWithSubscription,
} from "@/lib/gocardless";

const Body = z.object({ tierId: z.string().min(1) });

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });

  const plan = await prisma.plan.findUnique({
    where: { signupToken: token },
    include: {
      engineer: true,
      customer: { include: { properties: true } },
    },
  });
  if (!plan) return NextResponse.json({ error: "This link has expired." }, { status: 404 });
  if (plan.status !== "PENDING") {
    return NextResponse.json({ error: "This plan is already set up." }, { status: 409 });
  }

  const tier = await prisma.planTier.findFirst({
    where: { id: parsed.data.tierId, engineerId: plan.engineerId, archived: false },
  });
  if (!tier) return NextResponse.json({ error: "Pick a plan." }, { status: 400 });

  if (!plan.engineer.gcAccessToken) {
    return NextResponse.json(
      { error: `${plan.engineer.tradingName ?? "Your engineer"} hasn't finished their payment setup yet — let them know.` },
      { status: 409 },
    );
  }

  await prisma.plan.update({
    where: { id: plan.id },
    data: { tierId: tier.id, priceMonthlyPence: tier.priceMonthlyPence },
  });
  await track("tier_selected", { type: "CUSTOMER", id: plan.customerId }, {
    planId: plan.id,
    tierId: tier.id,
    name: tier.name,
    priceMonthlyPence: tier.priceMonthlyPence,
  });

  const brand = plan.engineer.tradingName ?? plan.engineer.slug;
  const base = `${process.env.APP_URL}/p/${plan.engineer.slug}/signup/${token}`;
  const property = plan.customer.properties[0];

  try {
    const br = await createBillingRequestWithSubscription(plan.engineer.gcAccessToken, {
      amountPence: tier.priceMonthlyPence,
      appFeePence: appFeePence(tier.priceMonthlyPence),
      name: `${brand} — ${tier.name} care plan`,
    });
    const flow = await createBillingRequestFlow(plan.engineer.gcAccessToken, {
      billingRequestId: br.id,
      redirectUri: `${base}/confirmed`,
      exitUri: base,
      prefilled: {
        given_name: plan.customer.firstName,
        family_name: plan.customer.lastName,
        email: plan.customer.email ?? undefined,
        address_line1: property?.addressLine1,
        city: property?.town ?? undefined,
        postal_code: property?.postcode,
      },
    });
    await prisma.plan.update({
      where: { id: plan.id },
      data: { gcBillingRequestId: br.id, gcBillingRequestFlowId: flow.id },
    });
    return NextResponse.json({ authorisationUrl: flow.authorisation_url });
  } catch (err) {
    console.error("[signup] billing request failed:", err);
    return NextResponse.json(
      { error: "Could not start the Direct Debit setup — try again in a minute." },
      { status: 502 },
    );
  }
}
