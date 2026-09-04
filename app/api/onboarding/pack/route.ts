import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";

const Body = z.object({ address: z.string().min(10).max(400) });

// E2 step 4 — founding-member pack (QR cards + van sticker). Just records the
// address and marks it requested; fulfilment is a human task.
export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your full postal address." }, { status: 400 });
  }

  await prisma.engineer.update({
    where: { id: engineerId },
    data: { packAddress: parsed.data.address.trim(), packRequestedAt: new Date() },
  });
  await track("founding_pack_requested", { type: "ENGINEER", id: engineerId }, {});
  return NextResponse.json({ ok: true });
}
