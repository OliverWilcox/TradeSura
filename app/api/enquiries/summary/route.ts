import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { enquiriesThisMonth, startOfMonth } from "@/lib/enquiries";
import { websiteSales } from "@/lib/website-sales";

// Home's growth card: "TradeSura sent you N enquiries this month", and the
// "Add TradeSura to your website" nudge until the widget is live.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const e = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { websiteConnectedAt: true, widgetDisabledAt: true },
  });
  if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const since = startOfMonth();
  const live = Boolean(e.websiteConnectedAt) && !e.widgetDisabledAt;
  // Review 4 — "where do Message enquiries land?" Recent messages get their
  // own line on Home so they're never only inside a monthly count.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  return NextResponse.json({
    enquiriesThisMonth: await enquiriesThisMonth(engineerId),
    messagesThisWeek: await prisma.enquiry.count({ where: { engineerId, kind: "message", createdAt: { gte: weekAgo } } }),
    websiteLive: live,
    websiteDisabled: Boolean(e.widgetDisabledAt),
    websiteSalesThisMonth: live ? await websiteSales(engineerId, since) : 0,
  });
}
