import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { publicRatings, ratingSummary } from "@/lib/ratings";
import { reasonLabel } from "@/lib/retention";
import { startOfMonth } from "@/lib/enquiries";
import { websiteSales } from "@/lib/website-sales";
import { isKept } from "@/lib/admin-metrics";

// Section 10 — the installer's own version of the admin numbers: why
// customers asked to cancel (and how many stayed), ratings, enquiries and
// website sales. Owners only (money-adjacent; staff see no numbers).
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const month = startOfMonth();
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const e = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { websiteConnectedAt: true, widgetDisabledAt: true },
  });
  if (!e) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const [requests, rating, ratings, enquiries, sold, live] = await Promise.all([
    prisma.cancelRequest.findMany({
      where: { engineerId, createdAt: { gte: since90 } },
      select: { reason: true, outcome: true },
    }),
    ratingSummary(engineerId),
    publicRatings(engineerId, 5),
    prisma.enquiry.groupBy({ by: ["kind"], where: { engineerId, createdAt: { gte: month } }, _count: true }),
    websiteSales(engineerId, month),
    prisma.plan.count({ where: { engineerId, status: { in: ["ACTIVE", "PAUSED"] } } }),
  ]);

  const byReason = new Map<string, { reason: string; label: string; requests: number; stayed: number }>();
  for (const r of requests) {
    const x = byReason.get(r.reason) ?? { reason: r.reason, label: reasonLabel(r.reason), requests: 0, stayed: 0 };
    x.requests += 1;
    if (isKept(r.outcome)) x.stayed += 1;
    byReason.set(r.reason, x);
  }
  const calls = enquiries.find((q) => q.kind === "call")?._count ?? 0;
  const messages = enquiries.find((q) => q.kind === "message")?._count ?? 0;

  return NextResponse.json({
    livePlans: live,
    cancellations: {
      requests: requests.length,
      stayed: requests.filter((r) => isKept(r.outcome)).length,
      cancelled: requests.filter((r) => r.outcome === "cancelled").length,
      reasons: [...byReason.values()].sort((a, b) => b.requests - a.requests),
    },
    ratings: {
      ...rating,
      recent: ratings.map((r) => ({ ...r, ratedAt: r.ratedAt.toISOString(), repliedAt: r.repliedAt?.toISOString() ?? null })),
    },
    enquiries: { total: calls + messages, calls, messages },
    website: {
      live: Boolean(e.websiteConnectedAt) && !e.widgetDisabledAt,
      soldThisMonth: sold,
    },
  });
}
