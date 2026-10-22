import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { ratingSummary } from "@/lib/ratings";

// Section 5 — the installer's Ratings screen: every rating, newest first,
// with its public reply (if any). Removed ratings stay listed with the reason
// so the installer can see what came down and why.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [summary, rows] = await Promise.all([
    ratingSummary(engineerId),
    prisma.rating.findMany({
      where: { engineerId, ratedAt: { not: null } },
      orderBy: { ratedAt: "desc" },
      take: 200,
      include: { plan: { select: { customerId: true } } },
    }),
  ]);
  return NextResponse.json({
    summary,
    ratings: rows.map((r) => ({
      id: r.id,
      stars: r.stars,
      comment: r.comment,
      customerName: r.customerName,
      customerId: r.plan.customerId,
      ratedAt: r.ratedAt!.toISOString(),
      reply: r.reply,
      repliedAt: r.repliedAt?.toISOString() ?? null,
      removedReason: r.removedAt ? r.removedReason : null,
    })),
  });
}
