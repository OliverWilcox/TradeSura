import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { storeGasSafeCard } from "@/lib/gas-safe-card";

const Body = z.object({ base64: z.string().min(1), mimeType: z.string().min(1) });

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Add a photo of your Gas Safe ID card." }, { status: 400 });
  }
  const stored = await storeGasSafeCard(parsed.data.base64, parsed.data.mimeType);
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 400 });
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      gasSafeCardUrl: stored.url,
      gasSafeRejectedAt: null,
      gasSafeRejectReason: null,
      gasSafeReviewRequestedAt: new Date(),
    },
  });
  await track("gas_safe_card_added", { type: "ENGINEER", id: engineerId }, {});
  return NextResponse.json({ ok: true });
}
