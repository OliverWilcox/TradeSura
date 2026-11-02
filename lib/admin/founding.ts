import { prisma } from "@/lib/db";
import { milestones, realEngineerWhere, type TestMarks } from "@/lib/admin/metrics";

// Founding spots (client feedback 4.4 and engineer record 3). These rules are
// defaults until the client's spec confirms them:
// - each town has FOUNDING_SPOTS_PER_TOWN spots, given to its engineers in
//   the order they were verified;
// - a spot's clock runs FOUNDING_CLOCK_DAYS from when the engineer got it. If
//   their first plan goes live in that time the spot is theirs to keep;
//   otherwise it's released to the next engineer in line, whose clock
//   starts then;
// - of those holding a spot, whoever has held it longest has the top spot;
//   the others have the Founding badge.
// Who's in line: real engineers (lib/admin/metrics.ts), verified, not banned
// and still with TradeSura, with a town page. It's worked out afresh each
// time, so a ban or a change of town moves the line along.

export const FOUNDING_SPOTS_PER_TOWN = 3;
export const FOUNDING_CLOCK_DAYS = 60;

const DAY_MS = 86_400_000;

export type FoundingCandidate = { id: string; verifiedAt: Date; planLive: boolean; planLiveAt: Date | null };

export type FoundingState =
  | { state: "top_spot" | "badge"; position: number; since: Date; clockEndsAt: Date; kept: boolean }
  | { state: "released"; since: Date; releasedAt: Date }
  | { state: "waiting"; place: number };

/**
 * One town's spots at an instant. A first plan live with no date on record
 * went live before the app logged it, so it keeps the spot.
 */
export function allocateFounding(candidates: FoundingCandidate[], now: Date, spots = FOUNDING_SPOTS_PER_TOWN): Map<string, FoundingState> {
  const line = candidates
    .filter((c) => c.verifiedAt <= now)
    .sort((a, b) => a.verifiedAt.getTime() - b.verifiedAt.getTime() || a.id.localeCompare(b.id));
  type Holder = { c: FoundingCandidate; since: Date; endsAt: Date; kept: boolean };
  const held: Holder[] = [];
  const waiting: FoundingCandidate[] = [];
  const out = new Map<string, FoundingState>();
  const give = (c: FoundingCandidate, at: Date) => {
    const endsAt = new Date(at.getTime() + FOUNDING_CLOCK_DAYS * DAY_MS);
    held.push({ c, since: at, endsAt, kept: c.planLive && (c.planLiveAt === null || c.planLiveAt < endsAt) });
  };
  let next = 0;
  for (;;) {
    const release = held.filter((h) => !h.kept && h.endsAt <= now).sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime())[0];
    const arrival = line[next];
    if (!release && !arrival) break;
    if (release && (!arrival || release.endsAt <= arrival.verifiedAt)) {
      held.splice(held.indexOf(release), 1);
      out.set(release.c.id, { state: "released", since: release.since, releasedAt: release.endsAt });
      const nextInLine = waiting.shift();
      if (nextInLine) give(nextInLine, release.endsAt);
    } else {
      next += 1;
      if (held.length < spots) give(arrival, arrival.verifiedAt);
      else waiting.push(arrival);
    }
  }
  held
    .sort((a, b) => a.since.getTime() - b.since.getTime() || a.c.verifiedAt.getTime() - b.c.verifiedAt.getTime())
    .forEach((h, i) => out.set(h.c.id, { state: i === 0 ? "top_spot" : "badge", position: i + 1, since: h.since, clockEndsAt: h.endsAt, kept: h.kept }));
  waiting.forEach((c, i) => out.set(c.id, { state: "waiting", place: i + 1 }));
  return out;
}

export type FoundingStatus = (FoundingState & { town: string }) | { state: "no_town" } | { state: "not_in_line"; reason: "not_verified" | "banned" | "left" | "test" | "staff" };

/** Founding status for some engineers, each worked out over everyone in their town. */
export async function foundingFor(marks: TestMarks, engineerIds: string[], now = new Date()): Promise<Map<string, FoundingStatus>> {
  const asked = engineerIds.length
    ? await prisma.engineer.findMany({ where: { id: { in: engineerIds } }, select: { id: true, ownerId: true, townSlug: true, gasSafeVerifiedAt: true, bannedAt: true, leftAt: true } })
    : [];
  const slugs = [...new Set(asked.map((e) => e.townSlug).filter((s): s is string => Boolean(s)))];
  const [inLine, towns] = slugs.length
    ? await Promise.all([
        prisma.engineer.findMany({
          where: { ...realEngineerWhere(marks), townSlug: { in: slugs }, gasSafeVerifiedAt: { not: null, lte: now }, bannedAt: null, leftAt: null },
          select: { id: true, townSlug: true, gasSafeVerifiedAt: true },
        }),
        prisma.townPage.findMany({ where: { slug: { in: slugs } }, select: { slug: true, name: true } }),
      ])
    : [[], []];
  const reached = inLine.length ? await milestones(marks, { ids: inLine.map((e) => e.id) }) : new Map();
  const townName = new Map(towns.map((t) => [t.slug, t.name]));
  const byTown = new Map<string, Map<string, FoundingState>>();
  for (const slug of slugs) {
    const candidates = inLine
      .filter((e) => e.townSlug === slug)
      .map((e) => ({ id: e.id, verifiedAt: e.gasSafeVerifiedAt!, planLive: reached.get(e.id)?.plan_live.reached ?? false, planLiveAt: reached.get(e.id)?.plan_live.at ?? null }));
    byTown.set(slug, allocateFounding(candidates, now));
  }
  return new Map(
    asked.map((e): [string, FoundingStatus] => {
      if (!e.townSlug && !e.ownerId) return [e.id, { state: "no_town" }];
      const state = e.townSlug ? byTown.get(e.townSlug)?.get(e.id) : undefined;
      if (state) return [e.id, { ...state, town: townName.get(e.townSlug!) ?? e.townSlug! }];
      const reason = e.ownerId ? "staff" : marks.engineers.includes(e.id) ? "test" : e.bannedAt ? "banned" : e.leftAt ? "left" : "not_verified";
      return [e.id, { state: "not_in_line", reason }];
    }),
  );
}
