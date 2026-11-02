import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

const Body = z.object({ action: z.enum(["stop", "start"]) });

// Build Guide v2 Part 7.2 LAW — "Stop offering / Start offering again is one
// reversible toggle (no separate 'paused' state)." Stopping retires the plan
// from the public page and offers; live customers are completely untouched
// (their agreedTier snapshot and Stripe subscription don't reference this
// endpoint at all).
export async function POST(req: Request, ctx: { params: Promise<{ tierId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { tierId } = await ctx.params;
  const tier = await prisma.planTier.findFirst({ where: { id: tierId, engineerId } });
  if (!tier) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check and try again." }, { status: 400 });

  if (parsed.data.action === "stop") {
    if (tier.status !== "LIVE") {
      return NextResponse.json({ error: "Only a live plan can be stopped." }, { status: 409 });
    }
    await prisma.planTier.update({ where: { id: tierId }, data: { status: "STOPPED" } });
    await track("plan_stopped", { type: "ENGINEER", id: engineerId }, { tierId, name: tier.name });
    return NextResponse.json({ ok: true, status: "STOPPED" as const });
  }

  if (tier.status !== "STOPPED") {
    return NextResponse.json({ error: "This plan isn't stopped." }, { status: 409 });
  }
  await prisma.planTier.update({ where: { id: tierId }, data: { status: "LIVE" } });
  await track("plan_restarted", { type: "ENGINEER", id: engineerId }, { tierId, name: tier.name });
  return NextResponse.json({ ok: true, status: "LIVE" as const });
}
