import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { adminEvent } from "@/lib/admin-api/audit";
import { AdminApiError, conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { page, type Page } from "@/lib/admin-api/pagination";
import { brandName } from "@/lib/engineer";
import {
  TOP_SPOT_DAYS,
  TOP_SPOT_REMINDER_DAYS,
  TOP_SPOTS_PER_TOWN,
  daysLeft,
  foundingMemberIds,
  rankingFacts,
  spotEndsAt,
  syncTownSpots,
  tellAwarded,
  townPageOrder,
} from "@/lib/founding";
import { townPageUrl } from "@/lib/public-url";
import { ratingSummary } from "@/lib/ratings";
import { LISTED_ENGINEER_WHERE } from "@/lib/town";
import { DEFAULT_FOUNDING_FIRST_MINUTES, FOUNDING_FIRST_MINUTES_KEY, foundingFirstMinutesFrom } from "@/lib/town-leads";

// Founding Members and town pages for the admin API (Matt, 4 Nov, section
// 3.2). The rules are the app's own (lib/founding.ts): the badge, the top 3
// per town, the 60-day clock and its reminders, the town page order. This
// shows them per town (each spot taken, live or released), lets an admin
// override them with a reason, and sets how long Founding Members get first
// pick of a town page's homeowner requests (lib/town-leads.ts).

export const TOWN_RULES = { spotsPerTown: TOP_SPOTS_PER_TOWN, spotDays: TOP_SPOT_DAYS, reminderDays: [...TOP_SPOT_REMINDER_DAYS] };

/** Public: on the web. Held: an admin is holding it back. Not public: no engineer listed there yet. */
export type TownPageState = "public" | "held" | "not_public";

export type TownSummary = {
  slug: string;
  name: string;
  page: TownPageState;
  /** The town's top spots (TOP_SPOTS_PER_TOWN). */
  spots: number;
  /** Held now. */
  taken: number;
  /** Held spots showing on the public town page. */
  live: number;
  released: number;
  /** Complete Founding Members who'd get the next free spot, in order. */
  nextInLine: number;
  foundingMembers: number;
  /** Engineers the town page lists. */
  listed: number;
};

const OWNERS_HERE = { deletedAt: null, ownerId: null } as const;
const titleCase = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const pageState = (heldAt: Date | null | undefined, listed: number): TownPageState => (heldAt ? "held" : listed ? "public" : "not_public");
const named = (e: { id: string; tradingName: string | null; legalName: string | null; slug: string }) => ({ id: e.id, name: brandName(e) });
const NAME_SELECT = { id: true, tradingName: true, legalName: true, slug: true } as const;

/** Every town with a page, an engineer or a spot, A–Z, with its spots and who's waiting for one. */
export async function listTowns(q: { q?: string; page: number; size: number }): Promise<Page<TownSummary>> {
  const [pages, engineers, listed, spots] = await Promise.all([
    prisma.townPage.findMany({ select: { slug: true, name: true, heldAt: true } }),
    prisma.engineer.findMany({
      where: { townSlug: { not: null }, ...OWNERS_HERE },
      select: { id: true, townSlug: true, town: true, accountCompletedAt: true, bannedAt: true, leftAt: true },
    }),
    prisma.engineer.findMany({ where: { townSlug: { not: null }, ...LISTED_ENGINEER_WHERE }, select: { id: true, townSlug: true } }),
    prisma.topSpot.findMany({ select: { townSlug: true, engineerId: true, releasedAt: true } }),
  ]);
  const founding = await foundingMemberIds(engineers.map((e) => e.id));
  const page_ = new Map(pages.map((p) => [p.slug, p]));
  const towns = new Map<string, TownSummary>();
  const town = (slug: string, name?: string | null) => {
    let t = towns.get(slug);
    if (!t) {
      t = { slug, name: page_.get(slug)?.name || name || titleCase(slug), page: "not_public", spots: TOP_SPOTS_PER_TOWN, taken: 0, live: 0, released: 0, nextInLine: 0, foundingMembers: 0, listed: 0 };
      towns.set(slug, t);
    }
    return t;
  };
  for (const p of pages) town(p.slug);
  const listedIn = new Map(listed.map((e) => [e.id, e.townSlug!]));
  for (const e of listed) town(e.townSlug!).listed += 1;
  const everHeld = new Set(spots.map((s) => `${s.townSlug} ${s.engineerId}`));
  for (const e of engineers) {
    const t = town(e.townSlug!, e.town);
    if (!founding.has(e.id)) continue;
    t.foundingMembers += 1;
    if (e.accountCompletedAt && !e.bannedAt && !e.leftAt && !everHeld.has(`${e.townSlug} ${e.id}`)) t.nextInLine += 1;
  }
  for (const t of towns.values()) t.page = pageState(page_.get(t.slug)?.heldAt, t.listed);
  for (const s of spots) {
    const t = town(s.townSlug);
    if (s.releasedAt) t.released += 1;
    else {
      t.taken += 1;
      if (t.page === "public" && listedIn.get(s.engineerId) === s.townSlug) t.live += 1;
    }
  }
  const search = q.q?.trim().toLowerCase();
  const all = [...towns.values()]
    .filter((t) => !search || t.name.toLowerCase().includes(search) || t.slug.includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  return page(all.slice((q.page - 1) * q.size, q.page * q.size), all.length, q);
}

type Person = { id: string; name: string };

export type TownDetail = {
  slug: string;
  name: string;
  page: TownPageState;
  url: string;
  rules: typeof TOWN_RULES;
  spots: {
    id: string;
    position: number;
    engineer: Person;
    heldFrom: string;
    endsAt: string;
    daysLeft: number;
    /** Signed a customer: the spot is theirs to keep. */
    customerSigned: boolean;
    remindersSent: number[];
    /** On the public town page now. */
    live: boolean;
    /** Given by an admin rather than in turn. */
    given: { by: string | null; reason: string | null } | null;
  }[];
  released: {
    id: string;
    engineer: Person;
    heldFrom: string;
    releasedAt: string;
    /** no_customer | left_town | account_closed | admin */
    reason: string | null;
    by: string | null;
    note: string | null;
  }[];
  nextInLine: (Person & { completedAt: string })[];
  /** The town page as it's ordered (lib/founding.ts townPageOrder), with what each place rests on. */
  order: (Person & {
    position: number;
    group: "top_spot" | "most_active" | "reviews";
    payingCustomers: number;
    reviews: { count: number; average: number | null; lastAt: string | null };
  })[];
  /** Who an admin can give a spot to: in this town, trading, not holding one. Next in line first. The owner tells apart businesses with the same name. */
  eligible: (Person & { owner: string | null; founding: boolean; nextInLine: boolean })[];
  leadWindowMinutes: number;
};

type SpotEvent = { by: string | null; note: string | null };

/** What admins said when they gave or released spots, by spot. */
async function adminSpotNotes(names: string[], spotIds: string[]): Promise<Map<string, SpotEvent>> {
  if (!spotIds.length) return new Map();
  const rows = await prisma.event.findMany({
    where: { name: { in: names }, actorType: "ADMIN", OR: spotIds.map((id) => ({ meta: { path: ["spotId"], equals: id } })) },
    select: { meta: true },
  });
  const out = new Map<string, SpotEvent>();
  for (const r of rows) {
    const m = (r.meta ?? {}) as { spotId?: string; adminName?: string; note?: string };
    if (m.spotId) out.set(m.spotId, { by: m.adminName ?? null, note: m.note ?? null });
  }
  return out;
}

export async function townDetail(slug: string, now = new Date()): Promise<TownDetail> {
  const [pageRow, engineers, listedRows, spots] = await Promise.all([
    prisma.townPage.findUnique({ where: { slug } }),
    prisma.engineer.findMany({
      where: { townSlug: slug, ...OWNERS_HERE },
      select: { ...NAME_SELECT, firstName: true, lastName: true, town: true, accountCompletedAt: true, bannedAt: true, leftAt: true },
    }),
    prisma.engineer.findMany({ where: { townSlug: slug, ...LISTED_ENGINEER_WHERE }, select: { ...NAME_SELECT, serviceArea: true } }),
    prisma.topSpot.findMany({ where: { townSlug: slug }, orderBy: [{ heldFrom: "asc" }, { id: "asc" }] }),
  ]);
  if (!pageRow && !engineers.length && !spots.length) throw notFound("There's no town with that name.");

  const open = spots.filter((s) => !s.releasedAt);
  const released = spots.filter((s) => s.releasedAt).sort((a, b) => b.releasedAt!.getTime() - a.releasedAt!.getTime());
  const listedIds = new Set(listedRows.map((e) => e.id));
  const pageNow = pageState(pageRow?.heldAt, listedRows.length);
  const spotPeople = await prisma.engineer.findMany({ where: { id: { in: spots.map((s) => s.engineerId) } }, select: NAME_SELECT });
  const person = new Map(spotPeople.map((e) => [e.id, named(e)]));
  const who = (id: string): Person => person.get(id) ?? { id, name: "Deleted engineer" };

  const [founding, signed, reminders, given, releasedBy, facts, leadWindow, openAnywhere] = await Promise.all([
    foundingMemberIds(engineers.map((e) => e.id)),
    open.length ? prisma.plan.groupBy({ by: ["engineerId"], where: { engineerId: { in: open.map((s) => s.engineerId) }, activatedAt: { not: null } }, _count: { _all: true } }) : [],
    open.length ? prisma.event.findMany({ where: { name: "top_spot_reminder", OR: open.map((s) => ({ meta: { path: ["spotId"], equals: s.id } })) }, select: { meta: true } }) : [],
    adminSpotNotes(["top_spot_awarded"], open.map((s) => s.id)),
    adminSpotNotes(["top_spot_released"], released.map((s) => s.id)),
    rankingFacts(listedRows.map((e) => e.id)),
    leadWindowMinutes(),
    prisma.topSpot.findMany({ where: { releasedAt: null, engineerId: { in: engineers.map((e) => e.id) } }, select: { engineerId: true } }),
  ]);
  const customerSigned = new Set(signed.map((s) => s.engineerId));
  const sent = new Map<string, number[]>();
  for (const r of reminders) {
    const m = (r.meta ?? {}) as { spotId?: string; days?: number };
    if (m.spotId && typeof m.days === "number") sent.set(m.spotId, [...(sent.get(m.spotId) ?? []), m.days].sort((a, b) => b - a));
  }

  const everHeld = new Set(spots.map((s) => s.engineerId));
  const nextInLine = engineers
    .filter((e) => founding.has(e.id) && e.accountCompletedAt && !e.bannedAt && !e.leftAt && !everHeld.has(e.id))
    .sort((a, b) => a.accountCompletedAt!.getTime() - b.accountCompletedAt!.getTime() || a.id.localeCompare(b.id))
    .map((e) => ({ ...named(e), completedAt: e.accountCompletedAt!.toISOString() }));

  const holding = new Map(open.map((s) => [s.engineerId, s.heldFrom]));
  const order = townPageOrder(
    await Promise.all(
      listedRows.map(async (e) => {
        const rating = await ratingSummary(e.id);
        const f = facts.get(e.id);
        return {
          ...named(e),
          topSpotFrom: holding.get(e.id) ?? null,
          payingCustomers: f?.payingCustomers ?? 0,
          ratingCount: rating.count,
          ratingAverage: rating.average,
          lastRatedAt: f?.lastRatedAt ?? null,
        };
      }),
    ),
  ).map((r, i) => ({
    id: r.id,
    name: r.name,
    position: i + 1,
    group: r.topSpotFrom ? ("top_spot" as const) : r.payingCustomers > 0 ? ("most_active" as const) : ("reviews" as const),
    payingCustomers: r.payingCustomers,
    reviews: { count: r.ratingCount, average: r.ratingAverage, lastAt: r.lastRatedAt?.toISOString() ?? null },
  }));

  const holdsOne = new Set(openAnywhere.map((s) => s.engineerId));
  const waiting = new Map(nextInLine.map((e, i) => [e.id, i]));
  const eligible = engineers
    .filter((e) => !e.bannedAt && !e.leftAt && !holdsOne.has(e.id))
    .map((e) => ({ ...named(e), owner: [e.firstName, e.lastName].filter(Boolean).join(" ") || null, founding: founding.has(e.id), nextInLine: waiting.has(e.id) }))
    .sort((a, b) => (waiting.get(a.id) ?? Infinity) - (waiting.get(b.id) ?? Infinity) || a.name.localeCompare(b.name, "en-GB"));

  return {
    slug,
    name: pageRow?.name || engineers.find((e) => e.town)?.town || titleCase(slug),
    page: pageNow,
    url: townPageUrl(slug),
    rules: TOWN_RULES,
    spots: open.map((s, i) => ({
      id: s.id,
      position: i + 1,
      engineer: who(s.engineerId),
      heldFrom: s.heldFrom.toISOString(),
      endsAt: spotEndsAt(s.heldFrom).toISOString(),
      daysLeft: daysLeft(s.heldFrom, now),
      customerSigned: customerSigned.has(s.engineerId),
      remindersSent: sent.get(s.id) ?? [],
      live: pageNow === "public" && listedIds.has(s.engineerId),
      given: given.has(s.id) ? { by: given.get(s.id)!.by, reason: given.get(s.id)!.note } : null,
    })),
    released: released.map((s) => ({
      id: s.id,
      engineer: who(s.engineerId),
      heldFrom: s.heldFrom.toISOString(),
      releasedAt: s.releasedAt!.toISOString(),
      reason: s.releaseReason,
      by: releasedBy.get(s.id)?.by ?? null,
      note: releasedBy.get(s.id)?.note ?? null,
    })),
    nextInLine,
    order,
    eligible,
    leadWindowMinutes: leadWindow,
  };
}

// ---------- the manual override ----------

const lockTown = (tx: Prisma.TransactionClient, slug: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`top_spots:${slug}`}))`;

async function townName(slug: string): Promise<string> {
  const p = await prisma.townPage.findUnique({ where: { slug }, select: { name: true } });
  return p?.name ?? titleCase(slug);
}

/** Gives a free spot in this town to an engineer who works here and holds none, recorded as the app records an award. */
async function giveIn(tx: Prisma.TransactionClient, admin: AdminPrincipal, slug: string, engineerId: string, note: string, now: Date) {
  const e = await tx.engineer.findFirst({
    where: { id: engineerId, townSlug: slug, ...OWNERS_HERE, bannedAt: null, leftAt: null },
    select: NAME_SELECT,
  });
  if (!e) throw new AdminApiError(400, "VALIDATION", "Choose an engineer who works in this town.", { engineerId: ["Choose an engineer who works in this town."] });
  if (await tx.topSpot.findFirst({ where: { engineerId, releasedAt: null }, select: { id: true } })) throw conflict(`${brandName(e)} already holds a top spot.`);
  if ((await tx.topSpot.count({ where: { townSlug: slug, releasedAt: null } })) >= TOP_SPOTS_PER_TOWN) {
    throw conflict("This town's top spots are all taken: release one first.");
  }
  const spot = await tx.topSpot.create({ data: { townSlug: slug, engineerId, heldFrom: now } });
  await adminEvent(admin, "top_spot_awarded", { spotId: spot.id, engineerId, townSlug: slug, note }, tx);
  return { spotId: spot.id, engineer: named(e) };
}

/** Gives a free spot to someone in particular. Its 60-day clock starts now, as any spot's does. */
export async function giveSpot(admin: AdminPrincipal, slug: string, input: { engineerId: string; reason: string }, now = new Date()) {
  const given = await prisma.$transaction(async (tx) => {
    await lockTown(tx, slug);
    return giveIn(tx, admin, slug, input.engineerId, input.reason, now);
  });
  await tellAwarded(given.engineer.id, await townName(slug), spotEndsAt(now)).catch((err) => console.error("[admin-towns] award message failed:", err));
  return { spotId: given.spotId, givenTo: given.engineer };
}

/**
 * Releases a spot before its time. It passes to the next in line, as when
 * the app releases one, or straight to someone the admin chose. Released by
 * an admin, they don't get it back in turn (the app never re-awards a town's
 * spot to someone who held one there).
 */
export async function releaseSpot(admin: AdminPrincipal, slug: string, spotId: string, input: { reason: string; to: string | null }, now = new Date()) {
  const done = await prisma.$transaction(async (tx) => {
    await lockTown(tx, slug);
    const spot = await tx.topSpot.findFirst({ where: { id: spotId, townSlug: slug } });
    if (!spot) throw notFound("There's no top spot with that ID in this town.");
    if (spot.releasedAt) throw conflict("That spot has already been released.");
    if (input.to === spot.engineerId) throw new AdminApiError(400, "VALIDATION", "They hold this spot: choose someone else.", { to: ["They hold this spot: choose someone else."] });
    await tx.topSpot.update({ where: { id: spot.id }, data: { releasedAt: now, releaseReason: "admin" } });
    await adminEvent(admin, "top_spot_released", { spotId, engineerId: spot.engineerId, townSlug: slug, reason: "admin", note: input.reason, to: input.to }, tx);
    const given = input.to ? await giveIn(tx, admin, slug, input.to, input.reason, now) : null;
    return { released: spot.engineerId, given };
  });
  let givenTo = done.given?.engineer ?? null;
  if (done.given) {
    await tellAwarded(done.given.engineer.id, await townName(slug), spotEndsAt(now)).catch((err) => console.error("[admin-towns] award message failed:", err));
  } else {
    // As the app does after any release: the next in line gets it, and is told.
    const plan = await syncTownSpots(slug, now);
    const next = plan.award[0];
    if (next) givenTo = named(await prisma.engineer.findUniqueOrThrow({ where: { id: next }, select: NAME_SELECT }));
  }
  return { released: done.released, givenTo };
}

// ---------- first pick of homeowner requests ----------

export async function leadWindowMinutes(): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key: FOUNDING_FIRST_MINUTES_KEY } });
  return foundingFirstMinutesFrom(row?.value);
}

/** How long a town's Founding Members see a town page request before everyone else. New requests only. */
export async function setLeadWindow(admin: AdminPrincipal, minutes: number) {
  return prisma.$transaction(async (tx) => {
    const row = await tx.appSetting.findUnique({ where: { key: FOUNDING_FIRST_MINUTES_KEY } });
    const before = foundingFirstMinutesFrom(row?.value);
    await tx.appSetting.upsert({ where: { key: FOUNDING_FIRST_MINUTES_KEY }, update: { value: String(minutes) }, create: { key: FOUNDING_FIRST_MINUTES_KEY, value: String(minutes) } });
    await adminEvent(admin, "town_lead_window_changed", { before, after: minutes }, tx);
    return { minutes, before };
  });
}

export const LEAD_WINDOW = { defaultMinutes: DEFAULT_FOUNDING_FIRST_MINUTES, maxMinutes: 24 * 60 };
