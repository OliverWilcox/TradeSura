import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

const Body = z.object({ address: z.string().trim().min(10).max(400) });

// Review 4 — Account shows where the member pack goes (the sign-up
// correspondence address) with Change. Only the address moves: unlike
// /api/onboarding/pack this never marks the pack as requested.
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your full postal address, including the postcode." }, { status: 400 });
  }
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { packShippedAt: true } });
  if (engineer?.packShippedAt) {
    return NextResponse.json(
      { error: "Your pack has already been posted. Email info@tradesura.com if it hasn't arrived." },
      { status: 409 },
    );
  }
  await prisma.engineer.update({ where: { id: engineerId }, data: { packAddress: parsed.data.address } });
  await track("pack_address_changed", { type: "ENGINEER", id: engineerId }, {});
  return NextResponse.json({ ok: true });
}
