import { prisma } from "@/lib/db";
import { adminEvent } from "@/lib/admin-api/audit";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";

// Marking an engineer or customer as test data, and back. A marked engineer
// takes their customers, offers and payments with them; a marked customer
// takes their plans and payments (lib/admin/metrics.ts). Both are recorded.

export type TestSubject = "engineer" | "customer";

async function subjectExists(type: TestSubject, id: string) {
  return type === "engineer"
    ? (await prisma.engineer.count({ where: { id, deletedAt: null } })) > 0
    : (await prisma.customer.count({ where: { id, engineer: { deletedAt: null } } })) > 0;
}

const NOT_FOUND = { engineer: "There's no engineer with that ID.", customer: "There's no customer with that ID." } as const;

export async function markTestData(admin: AdminPrincipal, type: TestSubject, id: string, reason: string | null) {
  if (!(await subjectExists(type, id))) throw notFound(NOT_FOUND[type]);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.adminTestMark.findUnique({ where: { subjectType_subjectId: { subjectType: type, subjectId: id } } });
    if (existing) throw conflict("This is already marked as test data.");
    const mark = await tx.adminTestMark.create({ data: { subjectType: type, subjectId: id, adminId: admin.id, adminName: admin.name, reason } });
    await adminEvent(admin, "admin_test_marked", { subjectType: type, subjectId: id, [`${type}Id`]: id, reason }, tx);
    return { isTest: true, markedAt: mark.createdAt.toISOString(), markedBy: mark.adminName };
  });
}

export async function unmarkTestData(admin: AdminPrincipal, type: TestSubject, id: string, reason: string | null) {
  if (!(await subjectExists(type, id))) throw notFound(NOT_FOUND[type]);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.adminTestMark.deleteMany({ where: { subjectType: type, subjectId: id } });
    if (!count) throw conflict("This isn't marked as test data.");
    await adminEvent(admin, "admin_test_unmarked", { subjectType: type, subjectId: id, [`${type}Id`]: id, reason }, tx);
    return { isTest: false, markedAt: null, markedBy: null };
  });
}

/** Whether a record is marked, and by whom. */
export async function testMarkOf(type: TestSubject, id: string) {
  const mark = await prisma.adminTestMark.findUnique({ where: { subjectType_subjectId: { subjectType: type, subjectId: id } } });
  return mark ? { isTest: true, markedAt: mark.createdAt.toISOString(), markedBy: mark.adminName } : { isTest: false, markedAt: null, markedBy: null };
}
