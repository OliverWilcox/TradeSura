import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";
import { isLandlordPlan } from "@/lib/clauses";
import { resolvePlanTier } from "@/lib/plan-tier";

// Review #18 — records which terms version the customer actually agreed to,
// called right before the Payment Element submits (components/embedded-
// checkout.tsx). Token-scoped like the rest of the customer signup flow
// (app/api/signup/[token]/**) — no engineer/customer auth on this surface.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({ where: { signupToken: token } });
  if (!plan) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

  // R9 — a Landlord plan needs the customer's confirmation the property is let.
  const body = await req.json().catch(() => ({}));
  const agreed = resolvePlanTier(plan);
  const landlord = Boolean(agreed && isLandlordPlan(agreed.clauses.map((c) => c.code)));
  if (landlord && body?.propertyLet !== true) {
    return NextResponse.json(
      { error: "This is a Landlord plan — tick to confirm the property is let.", code: "property_let_required" },
      { status: 400 },
    );
  }
  const now = new Date();
  await prisma.plan.update({
    where: { id: plan.id },
    data: {
      termsVersion: CURRENT_TERMS_VERSION,
      termsAgreedAt: now,
      ...(landlord ? { propertyLetConfirmedAt: now } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
