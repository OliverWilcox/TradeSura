import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";

// E7 — customer book, ranked by opportunity. Segments: all / on plan / not on
// plan (the default to-do list) / attention (payment issues, lapsed).
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [customers, failedEvents] = await Promise.all([
    prisma.customer.findMany({
      where: { engineerId },
      include: {
        plans: {
          select: {
            id: true,
            status: true,
            priceMonthlyPence: true,
            createdAt: true,
            linkOpenedAt: true,
            tier: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        properties: { include: { appliances: true } },
      },
    }),
    prisma.event.findMany({
      where: {
        name: "payment_failed",
        ts: { gte: thirtyDaysAgo },
        meta: { path: ["engineerId"], equals: engineerId },
      },
      select: { meta: true },
    }),
  ]);

  const failedPlanIds = new Set(
    failedEvents
      .map((e) => (e.meta as { planId?: string } | null)?.planId)
      .filter((x): x is string => Boolean(x)),
  );

  const now = Date.now();
  const rows = customers.map((c) => {
    const active = c.plans.find((p) => p.status === "ACTIVE" || p.status === "PAUSED");
    const lapsed = !active && c.plans.some((p) => p.status === "CANCELLED");
    const latestOffer = c.plans[0] ?? null;
    const offeredAt = latestOffer?.createdAt ?? null;
    const staleOffer =
      !active &&
      latestOffer != null &&
      !latestOffer.linkOpenedAt &&
      now - latestOffer.createdAt.getTime() > 7 * 864e5;
    const paymentIssue = c.plans.some((p) => failedPlanIds.has(p.id));
    const appliance = c.properties[0]?.appliances[0];
    return {
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      source: c.source,
      applianceLabel: appliance
        ? `${appliance.make ?? ""} ${appliance.model ?? ""}`.trim() || null
        : null,
      lastServicedAt: appliance?.lastServicedAt?.toISOString() ?? null,
      status: active
        ? active.status === "PAUSED"
          ? ("PAUSED" as const)
          : ("ACTIVE" as const)
        : lapsed
          ? ("LAPSED" as const)
          : ("NONE" as const),
      tierName: active?.tier?.name ?? null,
      priceMonthlyPence: active?.priceMonthlyPence ?? null,
      neverOffered: c.plans.length === 0,
      offeredAt: offeredAt?.toISOString() ?? null,
      staleOffer,
      paymentIssue,
    };
  });

  // Not-on-plan sort: never-offered first, then stale offers, then newest.
  const notOnPlanRank = (r: (typeof rows)[number]) =>
    r.neverOffered ? 0 : r.staleOffer ? 1 : 2;
  rows.sort((a, b) => {
    const ra = notOnPlanRank(a);
    const rb = notOnPlanRank(b);
    if (ra !== rb) return ra - rb;
    return (b.offeredAt ?? "").localeCompare(a.offeredAt ?? "");
  });

  const onPlan = rows.filter((r) => r.status === "ACTIVE" || r.status === "PAUSED").length;
  const attention = rows.filter((r) => r.paymentIssue || r.status === "LAPSED").length;
  const counts = {
    all: rows.length,
    onPlan,
    notOnPlan: rows.filter((r) => r.status === "NONE").length,
    lapsed: rows.filter((r) => r.status === "LAPSED").length,
    attention,
  };

  return NextResponse.json({ customers: rows, counts });
}
