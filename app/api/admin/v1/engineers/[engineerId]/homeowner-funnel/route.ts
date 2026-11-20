import { adminRoute, notFound } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { prisma } from "@/lib/db";
import { conversionReport } from "@/lib/admin/content";

export const GET = adminRoute<{ engineerId: string }>("engineers:read", async ({ req, params }) => {
  const range = parseRange(req);
  const e = await prisma.engineer.findFirst({ where: { id: params.engineerId, deletedAt: null }, select: { id: true, ownerId: true } });
  if (!e) throw notFound("There's no engineer with that ID.");
  return conversionReport(range, e.ownerId ? { soldById: e.id } : { engineerId: e.id });
});
