import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { cancelPlan } from "@/lib/cancel-plan";

// Build Review 2, ruling 5 — the engineer can end a customer's plan from the
// customer's page. A reason is required; the app confirms before calling.
const Body = z.object({ reason: z.string().trim().min(2).max(80) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Pick a reason for ending the plan." }, { status: 400 });
  }

  const { id } = await ctx.params;
  const plan = await prisma.plan.findFirst({
    where: { customerId: id, engineerId, status: { in: ["ACTIVE", "PAUSED", "PENDING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!plan) return NextResponse.json({ error: "This customer has no plan to end." }, { status: 404 });

  const result = await cancelPlan(plan.id, { by: "engineer", reason: parsed.data.reason });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
