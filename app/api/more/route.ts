import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { activeMonthlyPence } from "@/lib/plans";
import { appFeePence } from "@/lib/clauses";

// Mobile counterpart to the money/ops snapshot in app/more/page.tsx. The
// full Payouts & Collections screen (Screen 12) is P1 and stays web-only —
// this is just the "payouts summary" line item CLAUDE.md scoped into the
// More hub.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { totalPence, count } = await activeMonthlyPence(engineerId);
  const fee = appFeePence(totalPence);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [confirmed, failed, queuedSms] = await Promise.all([
    prisma.event.count({
      where: {
        name: "payment_confirmed",
        ts: { gte: monthStart },
        meta: { path: ["engineerId"], equals: engineerId },
      },
    }),
    prisma.event.count({
      where: {
        name: "payment_failed",
        ts: { gte: monthStart },
        meta: { path: ["engineerId"], equals: engineerId },
      },
    }),
    prisma.outboundSms.count({ where: { engineerId, status: "QUEUED" } }),
  ]);

  return NextResponse.json({ totalPence, count, fee, confirmed, failed, queuedSms });
}
