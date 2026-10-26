import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { AdminPrincipal } from "@/lib/admin-api/token";

// Every change made through the admin API is an Event with the ADMIN actor:
// the same event names the rest of the app uses (gas_safe_verified,
// member_pack_shipped…), so analytics read the same, plus who did it, from
// which admin request, and why. Pass the transaction the change runs in, so
// the change and its record are saved together or not at all.
function adminMeta(admin: AdminPrincipal, meta: Record<string, unknown>) {
  return { ...meta, via: "admin_api", adminName: admin.name, adminRole: admin.role, requestId: admin.requestId } as Prisma.InputJsonValue;
}

export async function adminEvent(
  admin: AdminPrincipal,
  name: string,
  meta: Record<string, unknown> = {},
  db: Prisma.TransactionClient = prisma,
) {
  await db.event.create({ data: { name, actorType: "ADMIN", actorId: admin.id, meta: adminMeta(admin, meta) } });
}

/** One event per change, for a change made to several records at once. */
export async function adminEvents(admin: AdminPrincipal, name: string, metas: Record<string, unknown>[], db: Prisma.TransactionClient = prisma) {
  if (!metas.length) return;
  await db.event.createMany({ data: metas.map((meta) => ({ name, actorType: "ADMIN" as const, actorId: admin.id, meta: adminMeta(admin, meta) })) });
}
