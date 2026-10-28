import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { displayName } from "@/lib/engineer";
import { adminEvent, adminEvents } from "@/lib/admin-api/audit";
import { likeTerm } from "@/lib/admin-api/db";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { personName } from "@/lib/admin/verifications";

// Founding-member packs for the admin API (Part 17.4). A pack is requested at
// signup, but the Verified Member seal never ships to an unverified, paused or
// banned account (Part 14 LAW): those wait in "held" until they can go. Someone
// posts the pack and marks it here; who did is recorded. This replaces the old
// /admin/verifications?key= page.

export type PackTab = "to_post" | "held" | "posted";

const requested = { deletedAt: null, packRequestedAt: { not: null } } satisfies Prisma.EngineerWhereInput;

const TAB_WHERE: Record<PackTab, Prisma.EngineerWhereInput> = {
  to_post: { ...requested, packShippedAt: null, gasSafeVerifiedAt: { not: null }, pausedAt: null, bannedAt: null },
  held: {
    ...requested,
    packShippedAt: null,
    OR: [{ gasSafeVerifiedAt: null }, { pausedAt: { not: null } }, { bannedAt: { not: null } }],
  },
  posted: { ...requested, packShippedAt: { not: null } },
};

const ORDER: Record<PackTab, Prisma.EngineerOrderByWithRelationInput[]> = {
  // Longest-verified first, so nobody waits behind newer badges.
  to_post: [{ gasSafeVerifiedAt: "asc" }, { id: "asc" }],
  held: [{ packRequestedAt: "asc" }, { id: "asc" }],
  posted: [{ packShippedAt: "desc" }, { id: "asc" }],
};

const SELECT = {
  id: true,
  slug: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  packAddress: true,
  packRequestedAt: true,
  packShippedAt: true,
  gasSafeVerifiedAt: true,
  pausedAt: true,
  bannedAt: true,
  businessType: true,
} satisfies Prisma.EngineerSelect;

type Row = Prisma.EngineerGetPayload<{ select: typeof SELECT }>;

function heldBecause(r: Row): "not_verified" | "paused" | "banned" | null {
  if (r.packShippedAt) return null;
  if (r.bannedAt) return "banned";
  if (r.pausedAt) return "paused";
  if (!r.gasSafeVerifiedAt) return "not_verified";
  return null;
}

/** Name, business or address containing the search text. */
function searchWhere(q: string | undefined): Prisma.EngineerWhereInput {
  if (!q) return {};
  const contains = { contains: likeTerm(q), mode: "insensitive" as const };
  return { OR: [{ firstName: contains }, { lastName: contains }, { tradingName: contains }, { legalName: contains }, { packAddress: contains }] };
}

export async function listMemberPacks(q: { tab: PackTab; q?: string; page: number; size: number }) {
  const where = { AND: [TAB_WHERE[q.tab], searchWhere(q.q)] };
  const [rows, total, toPost, held, posted] = await Promise.all([
    prisma.engineer.findMany({ where, orderBy: ORDER[q.tab], skip: (q.page - 1) * q.size, take: q.size, select: SELECT }),
    prisma.engineer.count({ where }),
    prisma.engineer.count({ where: TAB_WHERE.to_post }),
    prisma.engineer.count({ where: TAB_WHERE.held }),
    prisma.engineer.count({ where: TAB_WHERE.posted }),
  ]);
  const iso = (d: Date | null) => d?.toISOString() ?? null;
  return {
    items: rows.map((r) => ({
      id: r.id,
      name: personName(r),
      business: displayName(r),
      businessType: r.businessType,
      address: r.packAddress,
      requestedAt: iso(r.packRequestedAt),
      verifiedAt: iso(r.gasSafeVerifiedAt),
      postedAt: iso(r.packShippedAt),
      heldBecause: heldBecause(r),
    })),
    page: q.page,
    size: q.size,
    total,
    counts: { to_post: toPost, held, posted },
  };
}

/** Marks a pack as posted. Only one that may go out and hasn't yet: two admins can't both post it. */
export async function markPackPosted(admin: AdminPrincipal, engineerId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.engineer.updateMany({
      where: { id: engineerId, ...TAB_WHERE.to_post },
      data: { packShippedAt: now },
    });
    if (count === 0) {
      const row = await tx.engineer.findFirst({ where: { id: engineerId, deletedAt: null }, select: SELECT });
      if (!row) throw notFound("There's no engineer with that ID.");
      if (!row.packRequestedAt) throw conflict("This engineer hasn't asked for a member pack.");
      if (row.packShippedAt) throw conflict("This pack has already been marked as posted.");
      throw conflict(
        heldBecause(row) === "not_verified"
          ? "This pack can't go out until the engineer is Gas Safe verified."
          : "This pack can't go out while the engineer is paused or banned.",
      );
    }
    await adminEvent(admin, "member_pack_shipped", { engineerId }, tx);
  });
  return { id: engineerId, postedAt: now.toISOString() };
}

/** Why a pack can't be marked posted, for one that wasn't. */
function notPostable(row: Row | undefined): string {
  if (!row) return "There's no engineer with that ID.";
  if (!row.packRequestedAt) return "This engineer hasn't asked for a member pack.";
  if (row.packShippedAt) return "This pack has already been marked as posted.";
  return heldBecause(row) === "not_verified"
    ? "This pack can't go out until the engineer is Gas Safe verified."
    : "This pack can't go out while the engineer is paused or banned.";
}

/**
 * Marks several packs as posted on one date (today if not given). Each goes
 * only if it may go out and hasn't yet, checked and set in one statement, so
 * two admins can't both post one; the rest come back with the reason.
 */
export async function markPacksPosted(admin: AdminPrincipal, engineerIds: string[], postedOn?: string) {
  const at = postedOn ? new Date(`${postedOn}T12:00:00Z`) : new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Engineer" SET "packShippedAt" = ${at}, "updatedAt" = now()
      WHERE id = ANY(${engineerIds}) AND "deletedAt" IS NULL AND "packRequestedAt" IS NOT NULL AND "packShippedAt" IS NULL
        AND "gasSafeVerifiedAt" IS NOT NULL AND "pausedAt" IS NULL AND "bannedAt" IS NULL
      RETURNING id`;
    const posted = new Set(updated.map((u) => u.id));
    await adminEvents(admin, "member_pack_shipped", [...posted].map((engineerId) => ({ engineerId, ...(postedOn ? { postedOn } : {}) })), tx);
    const others = engineerIds.filter((id) => !posted.has(id));
    const rows = others.length ? await tx.engineer.findMany({ where: { id: { in: others }, deletedAt: null }, select: SELECT }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      posted: engineerIds.filter((id) => posted.has(id)),
      postedAt: at.toISOString(),
      skipped: others.map((id) => ({ id, reason: notPostable(byId.get(id)) })),
    };
  });
}
