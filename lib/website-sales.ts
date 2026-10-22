import { prisma } from "@/lib/db";

// Section 7 — "Your website sold 3 plans this month". Sign-ups from the
// widget carry channel "website" (the embed's Join adds ?src=website, which
// the plan page passes to /api/p/{slug}/start); a sale is one of those plans
// going live.
export async function websitePlanIds(engineerId?: string, since?: Date): Promise<string[]> {
  const events = await prisma.event.findMany({
    where: {
      name: "checkout_started",
      meta: { path: ["channel"], equals: "website" },
      ...(since ? { ts: { gte: new Date(since.getTime() - 31 * 24 * 60 * 60 * 1000) } } : {}),
    },
    select: { meta: true },
  });
  const ids = [
    ...new Set(
      events.map((e) => (e.meta as { planId?: string } | null)?.planId).filter((x): x is string => Boolean(x)),
    ),
  ];
  if (!engineerId || ids.length === 0) return ids;
  const plans = await prisma.plan.findMany({ where: { id: { in: ids }, engineerId }, select: { id: true } });
  return plans.map((p) => p.id);
}

export async function websiteSales(engineerId: string | undefined, since: Date): Promise<number> {
  const ids = await websitePlanIds(engineerId, since);
  if (ids.length === 0) return 0;
  return prisma.plan.count({ where: { id: { in: ids }, activatedAt: { gte: since } } });
}

// Per engineer, for admin.
export async function websiteSalesByEngineer(since: Date): Promise<Map<string, number>> {
  const ids = await websitePlanIds(undefined, since);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const plans = await prisma.plan.findMany({
    where: { id: { in: ids }, activatedAt: { gte: since } },
    select: { engineerId: true },
  });
  for (const p of plans) out.set(p.engineerId, (out.get(p.engineerId) ?? 0) + 1);
  return out;
}
