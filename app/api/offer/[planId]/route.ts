import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";

// Mobile counterpart to app/offer/[planId]/page.tsx — the signup link and its
// QR code, generated the same way (qrcode package, server-side) so the app
// doesn't need its own QR-rendering dependency.
export async function GET(_req: Request, ctx: { params: Promise<{ planId: string }> }) {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { planId } = await ctx.params;
  const plan = await prisma.plan.findFirst({ where: { id: planId, engineerId } });
  if (!plan) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const link = `${process.env.APP_URL}/p/${engineer.slug}/signup/${plan.signupToken}`;
  const qrDataUrl = await QRCode.toDataURL(link, { width: 280, margin: 1 });

  return NextResponse.json({ link, qrDataUrl });
}
