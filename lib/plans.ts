import crypto from "node:crypto";
import { prisma } from "@/lib/db";

export function newToken() {
  return crypto.randomBytes(12).toString("base64url");
}

export async function newPlanRef() {
  for (;;) {
    const ref = `TSH-${crypto.randomInt(1000, 10000)}`;
    if (!(await prisma.plan.findUnique({ where: { ref } }))) return ref;
  }
}

export async function activeMonthlyPence(engineerId: string) {
  const agg = await prisma.plan.aggregate({
    where: { engineerId, status: "ACTIVE" },
    _sum: { priceMonthlyPence: true },
    _count: true,
  });
  return { totalPence: agg._sum.priceMonthlyPence ?? 0, count: agg._count };
}
