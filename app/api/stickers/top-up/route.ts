import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth";
import { track } from "@/lib/track";
import { brandName } from "@/lib/engineer";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { stickerStock } from "@/lib/stickers";

// Section 4 — "Order more free": a free sticker top-up request, recorded as
// an event for the admin stickers view (Section 10) and emailed to the team
// that posts packs. One request a week is plenty.
export async function POST() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineerId = actor.businessId;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = await prisma.event.findFirst({
    where: { name: "sticker_topup_requested", ts: { gte: weekAgo }, meta: { path: ["engineerId"], equals: engineerId } },
  });
  if (recent) return NextResponse.json({ ok: true, alreadyRequested: true });

  const [stock, engineer] = await Promise.all([
    stickerStock(engineerId),
    prisma.engineer.findUniqueOrThrow({
      where: { id: engineerId },
      select: { tradingName: true, legalName: true, slug: true, packAddress: true },
    }),
  ]);
  await track("sticker_topup_requested", { type: "ENGINEER", id: actor.actorId }, {
    engineerId,
    left: stock.left,
  });
  const admin = process.env.ADMIN_EMAIL?.trim() || "info@tradesura.com";
  await sendEmail({
    to: admin,
    subject: `Sticker top-up — ${brandName(engineer)}`,
    html: `<p><b>${escapeHtml(brandName(engineer))}</b> asked for free boiler stickers. ${stock.left} left.</p>
<p>Post to: ${escapeHtml(engineer.packAddress ?? "no pack address on file — ask them")}</p>
<p>Mint codes with <code>npx tsx scripts/generate-stickers.ts --engineer ${escapeHtml(engineer.slug)} --count 25</code></p>`,
  }).catch((err) => console.error("[stickers] top-up email failed:", err));
  return NextResponse.json({ ok: true });
}
