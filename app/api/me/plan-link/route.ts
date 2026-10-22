import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { planLinkDisplay, planLinkUrl } from "@/lib/public-url";

// The engineer's shareable plan link + its QR, for the "plan is live"
// screen's Copy / WhatsApp / Show QR row.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const engineer = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { slug: true } });
  if (!engineer) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const url = planLinkUrl(engineer.slug);
  const qrDataUrl = await QRCode.toDataURL(`${url}?src=qr`, { width: 560, margin: 1 });
  return NextResponse.json({ url, display: planLinkDisplay(engineer.slug), qrDataUrl });
}
