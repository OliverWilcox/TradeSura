import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { adminEvent } from "@/lib/admin-api/audit";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { averageStars, isLowRating, removeRating } from "@/lib/ratings";
import { trustpilotInviteOf } from "@/lib/trustpilot";

const live = { deletedAt: null } satisfies Prisma.EngineerWhereInput;

const SOURCE_LABEL: Record<string, "service" | "offer"> = { service: "service", offer: "offer" };

export async function engineerReviews(engineerId: string) {
  const e = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { id: true, gasSafeVerifiedAt: true } });
  if (!e) throw notFound("There's no engineer with that ID.");
  const [rows, awaiting, trustpilot] = await Promise.all([
    prisma.rating.findMany({
      where: { engineerId, ratedAt: { not: null } },
      orderBy: { ratedAt: "desc" },
      select: {
        id: true,
        stars: true,
        comment: true,
        customerName: true,
        source: true,
        ratedAt: true,
        reply: true,
        repliedAt: true,
        removedAt: true,
        removedReason: true,
        plan: { select: { ref: true, tier: { select: { name: true } } } },
      },
    }),
    prisma.rating.count({ where: { engineerId, ratedAt: null } }),
    trustpilotInviteOf(engineerId, e.gasSafeVerifiedAt),
  ]);
  const published = rows.filter((r) => !r.removedAt && r.stars !== null);
  return {
    items: rows.map((r) => ({
      id: r.id,
      stars: r.stars ?? 0,
      low: r.stars !== null && isLowRating(r.stars),
      comment: r.comment,
      customer: r.customerName ?? "A customer",
      source: SOURCE_LABEL[r.source] ?? "service",
      plan: r.plan ? { ref: r.plan.ref, name: r.plan.tier?.name ?? null } : null,
      ratedAt: r.ratedAt!.toISOString(),
      reply: r.reply ? { text: r.reply, at: r.repliedAt?.toISOString() ?? null } : null,
      removed: r.removedAt ? { at: r.removedAt.toISOString(), reason: r.removedReason } : null,
    })),
    summary: {
      published: published.length,
      average: averageStars(published.map((r) => r.stars!)),
      removed: rows.length - published.length,
      awaiting,
    },
    trustpilot,
  };
}

export type EngineerReviews = Awaited<ReturnType<typeof engineerReviews>>;

export async function reportReview(admin: AdminPrincipal, engineerId: string, ratingId: string, reason: string) {
  const rating = await prisma.rating.findFirst({ where: { id: ratingId, engineerId, ratedAt: { not: null } }, select: { id: true, stars: true, removedAt: true } });
  if (!rating) throw notFound("There's no review with that ID on this engineer.");
  if (rating.removedAt) throw conflict("This review was already removed.");
  const result = await removeRating(ratingId, reason, `${admin.name} (admin)`);
  if (!result.ok) throw conflict(result.error);
  await adminEvent(admin, "review_reported", { engineerId, ratingId, stars: rating.stars, reason });
  return { id: ratingId, removed: true as const };
}
