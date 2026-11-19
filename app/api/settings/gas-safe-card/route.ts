import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { track } from "@/lib/track";
import { bothSidesTooBig, cardExpiry, storeGasSafeCard } from "@/lib/gas-safe-card";
import { queueCardAlert } from "@/lib/card-alert";
import { queueCardCheck } from "@/lib/admin/verifications";

export const maxDuration = 300;

// The expiry is optional so builds that don't ask for it keep working; a new
// photo without one clears the old card's date.
const Photo = z.object({ base64: z.string().min(1), mimeType: z.string().min(1) });
const Body = z.object({ base64: z.string().min(1), mimeType: z.string().min(1), expiresOn: cardExpiry.optional(), back: Photo.optional() });

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
  const together = bothSidesTooBig(parsed.data.base64, parsed.data.back?.base64);
  if (together) return NextResponse.json({ error: together, field: "back" }, { status: 400 });
  const stored = await storeGasSafeCard(parsed.data.base64, parsed.data.mimeType);
  if (!stored.ok) return NextResponse.json({ error: stored.error }, { status: 400 });
  const back = parsed.data.back ? await storeGasSafeCard(parsed.data.back.base64, parsed.data.back.mimeType) : null;
  if (back && !back.ok) return NextResponse.json({ error: back.error, field: "back" }, { status: 400 });
  const { gasSafeVerifiedAt } = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { gasSafeVerifiedAt: true } });
  await prisma.engineer.update({
    where: { id: engineerId },
    data: {
      ...(gasSafeVerifiedAt ? { gasSafeRecheckRequestedAt: new Date(), gasSafeRecheckReason: "New card uploaded" } : {}),
      gasSafeCardUrl: stored.url,
      gasSafeCardBackUrl: back?.ok ? back.url : null,
      gasSafeCardExpiresOn: parsed.data.expiresOn ?? null,
      gasSafeRejectedAt: null,
      gasSafeRejectReason: null,
      gasSafeReviewRequestedAt: new Date(),
    },
  });
  await track("gas_safe_card_added", { type: "ENGINEER", id: engineerId }, {});
  await queueCardAlert(engineerId, "settings");
  await queueCardCheck(engineerId);
  return NextResponse.json({ ok: true });
}
