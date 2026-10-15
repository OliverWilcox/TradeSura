import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { cancelPlan } from "@/lib/cancel-plan";

const Body = z.object({ reason: z.string().max(40).nullable().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const reason = Body.safeParse(await req.json().catch(() => ({}))).data?.reason ?? null;
  const plan = await prisma.plan.findUnique({ where: { portalToken: token }, select: { id: true } });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const result = await cancelPlan(plan.id, { by: "customer", reason });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
