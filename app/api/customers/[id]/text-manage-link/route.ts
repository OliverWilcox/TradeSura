import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { getEngineerId } from "@/lib/auth";
import { sendSms } from "@/lib/sms";
import { track } from "@/lib/track";

// Build Guide v2 Part 10 LAW — "There is no engineer-side cancel button.
// Cancellation lives only behind the customer's manage link — so every
// cancellation is provably customer-made. The engineer's tool is 'Text the
// manage link'." This is that tool: it never touches the plan itself, it
// just re-sends the customer their own portal link.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { id } = await ctx.params;
  const customer = await prisma.customer.findFirst({
    where: { id, engineerId },
    include: { plans: { orderBy: { createdAt: "desc" } } },
  });
  if (!customer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const plan =
    customer.plans.find((p) => p.status === "ACTIVE" || p.status === "PAUSED") ??
    customer.plans[0] ??
    null;
  if (!plan) {
    return NextResponse.json({ error: "This customer has never had a plan." }, { status: 409 });
  }

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const brand = brandName(engineer);
  const portalUrl = `${process.env.APP_URL}/portal/${plan.portalToken}`;
  await sendSms({
    engineerId,
    to: customer.phone,
    body: `Hi ${customer.firstName} — manage your ${brand} plan (view, update details, or cancel) here: ${portalUrl}`,
    messageClass: "TRANSACTIONAL",
    consentBasis: "engineer-initiated",
  });

  await track("manage_link_texted", { type: "ENGINEER", id: engineerId }, {
    customerId: id,
    planId: plan.id,
  });
  return NextResponse.json({ ok: true });
}
