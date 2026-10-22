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
  return NextResponse.json({
    enquiriesThisMonth: await enquiriesThisMonth(engineerId),
    websiteLive: live,
    websiteDisabled: Boolean(e.widgetDisabledAt),
    websiteSalesThisMonth: live ? await websiteSales(engineerId, since) : 0,
  });
}
