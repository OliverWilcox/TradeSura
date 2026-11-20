import { NextResponse, after } from "next/server";
import { z } from "zod";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { cardExpiry, storeGasSafeCard } from "@/lib/gas-safe-card";
import { queueCardAlert } from "@/lib/card-alert";
import { autoCheckCard } from "@/lib/card-check";

// The expiry is optional so builds that don't ask for it keep working; a new
// photo without one clears the old card's date.
const Body = z.object({
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  expiresOn: cardExpiry.optional(),
  // Matt 16 Nov — the back of the card, sent on its own after the front.
  side: z.enum(["front", "back"]).default("front"),
});

export async function POST(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const expiry = parsed.error.issues.some((i) => i.path[0] === "expiresOn");
    return NextResponse.json(
      { error: expiry ? "Enter the expiry date on your Gas Safe ID card. It can't have passed." : "Add a photo of your Gas Safe ID card." },
      { status: 400 },
    );
  }
  const stored = await storeGasSafeCard(parsed.data.base64, parsed.data.mimeType);
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 400 });
  if (parsed.data.side === "back") {
    const before = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { gasSafeCardBackUrl: true } });
    await prisma.engineer.update({ where: { id: engineerId }, data: { gasSafeCardBackUrl: stored.url } });
    if (before.gasSafeCardBackUrl) await del(before.gasSafeCardBackUrl).catch(() => {});
    await track("gas_safe_card_back_added", { type: "ENGINEER", id: engineerId }, {});
    return NextResponse.json({ ok: true });
  }
  const { gasSafeVerifiedAt } = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { gasSafeVerifiedAt: true } });
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      // A live engineer stays live; their new card brings the register re-check forward (Matt, 4 Nov).
      ...(gasSafeVerifiedAt ? { gasSafeRecheckRequestedAt: new Date(), gasSafeRecheckReason: "New card uploaded" } : {}),
      gasSafeCardUrl: stored.url,
      gasSafeCardExpiresOn: parsed.data.expiresOn ?? null,
      gasSafeRejectedAt: null,
      gasSafeRejectReason: null,
      gasSafeReviewRequestedAt: new Date(),
    },
  });
  await track("gas_safe_card_added", { type: "ENGINEER", id: engineerId }, {});
  await queueCardAlert(engineerId, "settings");
  // Matt: AI reads the card; a clear match makes them live (lib/card-check.ts).
  const image = { base64: parsed.data.base64, mimeType: parsed.data.mimeType };
  after(() => autoCheckCard(engineerId, image));
  return NextResponse.json({ ok: true });
}
