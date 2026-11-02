import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { planLinkDisplay, planLinkUrl } from "@/lib/public-url";
import { planSlugs } from "@/lib/plan-slugs";

// The engineer's shareable plan link + its QR, for the "plan is live"
// screen's Copy / WhatsApp / Show QR row. Review 4 — with ?tierId= it's that
// plan's own link (tradesura.com/{slug}/{plan}); without, the business page.
export async function GET(req: Request) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { slug: true } });
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const tierId = new URL(req.url).searchParams.get("tierId");
  let planSlug: string | null = null;
  if (tierId) {
    const tiers = await prisma.planTier.findMany({
      where: { engineerId, status: "LIVE" },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    });
    planSlug = planSlugs(tiers).get(tierId) ?? null;
  }
  const url = planLinkUrl(engineer.slug, planSlug);
  const qrDataUrl = await QRCode.toDataURL(`${url}?src=qr`, { width: 560, margin: 1 });
  return NextResponse.json({ url, display: planLinkDisplay(engineer.slug, planSlug), qrDataUrl });
}
