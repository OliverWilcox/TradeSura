import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CURRENT_TERMS_VERSION } from "@/lib/terms";

// Review #18 — records which terms version the customer actually agreed to,
// called right before the Payment Element submits (components/embedded-
// checkout.tsx). Token-scoped like the rest of the customer signup flow
// (app/api/signup/[token]/**) — no engineer/customer auth on this surface.
export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const plan = await prisma.plan.findUnique({ where: { signupToken: token } });
  if (!plan) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

  await prisma.plan.update({
    where: { id: plan.id },
    data: { termsVersion: CURRENT_TERMS_VERSION, termsAgreedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
