import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { sendSms } from "@/lib/sms";
import { signupUrl } from "@/lib/public-url";
import { track } from "@/lib/track";

// 30 Oct update §7.8 — "Prefer to use your own phone? Text me the link"
// under the Direct Debit step's main button: texts this sign-up's own link
// to the mobile already entered, which reopens it where they left off.
// The customer asked for it, so it's transactional; once a minute at most.
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({
    where: { signupToken: token },
    include: { engineer: true, customer: true },
  });
  if (!plan || plan.status !== "PENDING") return NextResponse.json({ error: "This sign-up has finished." }, { status: 404 });
  if (!plan.customer.phone) return NextResponse.json({ error: "We don't have a mobile number for you." }, { status: 400 });

  const recent = await prisma.event.count({
    where: {
      name: "signup_link_texted",
      ts: { gte: new Date(Date.now() - 60_000) },
      meta: { path: ["planId"], equals: plan.id },
    },
  });
  if (recent > 0) return NextResponse.json({ ok: true, alreadySent: true });

  const brand = brandName(plan.engineer);
  await sendSms({
    engineerId: plan.engineerId,
    to: plan.customer.phone,
    body: `Hi ${plan.customer.firstName}, here's your link to finish joining ${brand}'s care plan on your own phone: ${signupUrl(plan.engineer.slug, token)}`,
    messageClass: "TRANSACTIONAL",
    consentBasis: "customer-requested",
  });
  await track("signup_link_texted", { type: "CUSTOMER", id: plan.customerId }, { planId: plan.id, engineerId: plan.engineerId });
  return NextResponse.json({ ok: true });
}
