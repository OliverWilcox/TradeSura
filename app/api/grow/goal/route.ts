import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";
import { growSummary } from "@/lib/grow";

// Matt, 6 Nov — First month goal: plans to sign this calendar month. Owners
// only (staff see no money, and the goal is shown with what it's worth).
const Body = z.object({ target: z.number().int().min(1).max(500).nullable() });

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (actor.role === "staff") return NextResponse.json({ error: "Only the owner sets the goal." }, { status: 403 });
  return NextResponse.json((await growSummary(actor.businessId)).goal);
}

export async function PUT(req: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (actor.role === "staff") return NextResponse.json({ error: "Only the owner sets the goal." }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter how many plans, from 1 to 500." }, { status: 400 });
  await prisma.engineer.update({
    where: { id: actor.businessId },
    data: { monthlyGoal: parsed.data.target, monthlyGoalSetAt: new Date(), goalNudgedAt: null },
  });
  await track("grow_goal_set", { type: "ENGINEER", id: actor.businessId }, { target: parsed.data.target });
  return NextResponse.json((await growSummary(actor.businessId)).goal);
}
