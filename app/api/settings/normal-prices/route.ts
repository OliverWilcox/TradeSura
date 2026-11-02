import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

// 30 Oct update §5 — "What do you normally charge for a service?", "…for a
// call-out?" and any repair discount. Asked blank in the plan builder; the
// customer page's value sum (lib/value-sum.ts) uses only these figures.
// Null clears a figure. Owners only: getEngineerId() is null for staff.
const pence = z.number().int().min(100).max(100000).nullable();
const Body = z.object({
  normalServicePence: pence.optional(),
  normalCalloutPence: pence.optional(),
  repairDiscountPercent: z.number().int().min(1).max(90).nullable().optional(),
});

const select = { normalServicePence: true, normalCalloutPence: true, repairDiscountPercent: true } as const;

export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select });
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(engineer);
}

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a price between £1 and £1,000, and a discount up to 90%." }, { status: 400 });
  }
  const saved = await prisma.engineer.update({ where: { id: engineerId }, data: parsed.data, select });
  await track("normal_prices_set", { type: "ENGINEER", id: engineerId }, { ...saved }).catch(() => {});
  return NextResponse.json(saved);
}
