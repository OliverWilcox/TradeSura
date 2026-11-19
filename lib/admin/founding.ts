import { prisma } from "@/lib/db";
import { TOP_SPOT_DAYS, TOP_SPOT_REMINDER_DAYS, TOP_SPOTS_PER_TOWN, daysLeft, foundingMemberIds, spotEndsAt } from "@/lib/founding";

export const FOUNDING_RULES = { spotsPerTown: TOP_SPOTS_PER_TOWN, spotDays: TOP_SPOT_DAYS, reminderDays: [...TOP_SPOT_REMINDER_DAYS] };

export type FoundingSpot =
  | { state: "holding"; position: number; heldFrom: Date; endsAt: Date; daysLeft: number; kept: boolean; remindersSent: number[] }
  | { state: "released"; heldFrom: Date; releasedAt: Date; reason: string | null };

export type FoundingStatus = { member: boolean; town: string | null; spot: FoundingSpot | null };

export function foundingLabel(f: FoundingStatus | undefined): "Founding · top spot" | "Founding" | "Standard" {
  if (f?.spot?.state === "holding") return "Founding · top spot";
  return f?.member ? "Founding" : "Standard";
}

export async function foundingFor(engineerIds: string[], now = new Date()): Promise<Map<string, FoundingStatus>> {
  if (!engineerIds.length) return new Map();
  const [members, spots] = await Promise.all([
    foundingMemberIds(engineerIds),
    prisma.topSpot.findMany({ where: { engineerId: { in: engineerIds } }, orderBy: { heldFrom: "desc" } }),
  ]);
  const spotOf = new Map<string, (typeof spots)[number]>();
  for (const s of spots) {
    const seen = spotOf.get(s.engineerId);
    if (!seen || (seen.releasedAt && !s.releasedAt)) spotOf.set(s.engineerId, s);
  }
  const open = [...spotOf.values()].filter((s) => !s.releasedAt);
  const townSlugs = [...new Set([...spotOf.values()].map((s) => s.townSlug))];
  const [towns, holders, customers, reminders] = await Promise.all([
    townSlugs.length ? prisma.townPage.findMany({ where: { slug: { in: townSlugs } }, select: { slug: true, name: true } }) : [],
    open.length ? prisma.topSpot.findMany({ where: { townSlug: { in: open.map((s) => s.townSlug) }, releasedAt: null }, orderBy: { heldFrom: "asc" }, select: { id: true, townSlug: true } }) : [],
    open.length ? prisma.plan.groupBy({ by: ["engineerId"], where: { engineerId: { in: open.map((s) => s.engineerId) }, activatedAt: { not: null } }, _count: { _all: true } }) : [],
    open.length ? prisma.event.findMany({ where: { name: "top_spot_reminder", OR: open.map((s) => ({ meta: { path: ["spotId"], equals: s.id } })) }, select: { meta: true } }) : [],
  ]);
  const townName = new Map(towns.map((t) => [t.slug, t.name]));
  const signed = new Set(customers.map((c) => c.engineerId));
  const sent = new Map<string, number[]>();
  for (const r of reminders) {
    const meta = (r.meta ?? {}) as { spotId?: string; days?: number };
    if (meta.spotId && typeof meta.days === "number") sent.set(meta.spotId, [...(sent.get(meta.spotId) ?? []), meta.days].sort((a, b) => b - a));
  }
  return new Map(
    engineerIds.map((id): [string, FoundingStatus] => {
      const s = spotOf.get(id);
      const town = s ? (townName.get(s.townSlug) ?? s.townSlug) : null;
      const spot: FoundingSpot | null = !s
        ? null
        : s.releasedAt
          ? { state: "released", heldFrom: s.heldFrom, releasedAt: s.releasedAt, reason: s.releaseReason }
          : {
              state: "holding",
              position: holders.filter((h) => h.townSlug === s.townSlug).findIndex((h) => h.id === s.id) + 1,
              heldFrom: s.heldFrom,
              endsAt: spotEndsAt(s.heldFrom),
              daysLeft: daysLeft(s.heldFrom, now),
              kept: signed.has(id),
              remindersSent: sent.get(s.id) ?? [],
            };
      return [id, { member: members.has(id) || spot?.state === "holding", town, spot }];
    }),
  );
}
