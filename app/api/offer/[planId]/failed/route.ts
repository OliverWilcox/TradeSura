import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";

// The app couldn't hand the offer to WhatsApp (not installed), so the
// customer never got it. Recorded as offer_failed for the admin's offer
// counts; the app then offers the link another way.
const Body = z.object({ channel: z.literal("whatsapp") });

export async function POST(req: Request, ctx: { params: Promise<{ planId: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your request." }, { status: 400 });

  const { planId } = await ctx.params;
  const plan = await prisma.plan.findFirst({
    where: { id: planId, engineerId: actor.businessId, ...(actor.role === "staff" ? { soldById: actor.actorId } : {}) },
    select: { id: true, customerId: true },
  });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await track("offer_failed", { type: "ENGINEER", id: actor.businessId }, {
    planId: plan.id,
    customerId: plan.customerId,
    soldById: actor.actorId,
    channel: parsed.data.channel,
  });
  return NextResponse.json({ ok: true });
}
