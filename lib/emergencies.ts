import { prisma } from "@/lib/db";

// Gas-emergency interlock triggers on this engineer's own customers' plans in
// the last 7 days. The event is logged against the plan, so filter by the
// engineer's plan ids — an unfiltered count showed every engineer everyone's.
export async function recentEmergencyCount(engineerId: string): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const plans = await prisma.plan.findMany({ where: { engineerId }, select: { id: true } });
  if (plans.length === 0) return 0;
  return prisma.event.count({
    where: {
      name: "emergency_interlock_triggered",
      ts: { gte: since },
      OR: plans.map((p) => ({ meta: { path: ["planId"], equals: p.id } })),
    },
  });
}
