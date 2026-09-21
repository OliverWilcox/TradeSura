import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

// Build Guide v2 Part 8, Step 4 — "Make this plan live." The wizard commits
// nothing until this call; a DRAFT becomes LIVE and is offerable from this
// moment on. This is literally the gate's plan-exists leg switching on
// (Part 8: "This tap is literally the gate's plan-exists leg switching on").
export async function POST(req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { tierId } = await ctx.params;
  const tier = await prisma.planTier.findFirst({ where: { id: tierId, engineerId } });
  if (!tier) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  if (tier.status === "LIVE") {
    return NextResponse.json({ ok: true, status: "LIVE" as const });
  }
  if (tier.status === "STOPPED") {
    return NextResponse.json(
      { error: "This plan was stopped, not drafted — use “Start offering again” instead." },
      { status: 409 },
    );
  }

  await prisma.planTier.update({ where: { id: tierId }, data: { status: "LIVE" } });
  await track("plan_live", { type: "ENGINEER", id: engineerId }, {
    tierId,
    name: tier.name,
    priceMonthlyPence: tier.priceMonthlyPence,
  });

  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { slug: true },
  });
  return NextResponse.json({ ok: true, status: "LIVE" as const, slug: engineer?.slug ?? null });
}
