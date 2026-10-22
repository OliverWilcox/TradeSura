import { prisma } from "@/lib/db";

// Section 6 — profiles live at tradesura.com/gas-engineers/{townSlug}/{slug}
// and each town gets a listing page. The town is the engineer's own words
// where we have them (the first place named in "Areas covered"), otherwise
// the local authority district their business postcode sits in.

// "Stoke-on-Trent" → "stoke-on-trent", "St Albans" → "st-albans".
export function townSlugOf(town: string): string {
  return town
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Postcode districts and areas ("HD1", "HD", "BN2 5"), not place names.
const POSTCODE_TOKEN = /^[a-z]{1,2}(\d[a-z\d]?(\s*\d[a-z]{0,2})?)?$/i;
// Leading words that aren't part of the place ("covering Leeds", "the Colne Valley").
const FILLER = /^(?:(?:covering|cover|serving|across|around|in|all of|and|the|greater|areas?|including|plus)\s+)+/i;

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (/^(on|upon|under|le|by|in|the|and|of)$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("")
    .replace(/^./, (c) => c.toUpperCase());
}

// The first place named in a free-text service area. "Huddersfield,
// Holmfirth and the Colne Valley" → "Huddersfield"; "HD1, HD2" → null.
export function townFromServiceArea(area: string | null | undefined): string | null {
  if (!area) return null;
  const parts = area
    .split(/,|;|\/|\||·|\band\b|&|\+|\n/i)
    .map((p) => p.replace(/\(.*?\)/g, "").replace(FILLER, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const p of parts) {
    if (POSTCODE_TOKEN.test(p)) continue;
    if (!/[a-z]{3,}/i.test(p)) continue;
    if (p.length > 40) continue;
    return titleCase(p);
  }
  return null;
}

// postcodes.io returns e.g. "Kirklees", "Brighton and Hove", "County Durham".
export function townFromDistrict(district: string | null | undefined): string | null {
  const d = district?.replace(/^(City of|County)\s+/i, "").trim();
  return d ? titleCase(d) : null;
}

// Free, keyless postcode data (ONS). Network failures fall back to null —
// the profile still works at tradesura.com/{slug} without a town.
export async function districtForPostcode(postcode: string): Promise<string | null> {
  const pc = postcode.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc)) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { admin_district?: string | null } };
    return json.result?.admin_district ?? null;
  } catch {
    return null;
  }
}

export async function deriveTown(e: { serviceArea: string | null; postcode: string | null }): Promise<string | null> {
  return (
    townFromServiceArea(e.serviceArea) ??
    (e.postcode ? townFromDistrict(await districtForPostcode(e.postcode)) : null)
  );
}

// Fill town/townSlug when missing (on profile publish) and make sure the
// town has a TownPage row so admin can publish or hold it.
export async function ensureEngineerTown(engineerId: string): Promise<{ town: string; townSlug: string } | null> {
  const e = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { town: true, townSlug: true, serviceArea: true, postcode: true },
  });
  if (!e) return null;
  let town = e.town?.trim() || null;
  let slug = e.townSlug || null;
  if (!town) town = await deriveTown(e);
  if (!town) return null;
  if (!slug) slug = townSlugOf(town);
  if (!slug) return null;
  if (town !== e.town || slug !== e.townSlug) {
    await prisma.engineer.update({ where: { id: engineerId }, data: { town, townSlug: slug } });
  }
  await prisma.townPage.upsert({ where: { slug }, update: {}, create: { slug, name: town } });
  return { town, townSlug: slug };
}

// ---------- town publish rule ----------

export type TownEngineer = {
  gasSafeVerifiedAt: Date | null;
  profilePublishedAt: Date | null;
  liveTiers: number;
  leftAt: Date | null;
  bannedAt: Date | null;
  deletedAt: Date | null;
  ownerId: string | null;
};

// A real engineer for a town page: verified, chose to publish, has a plan
// customers can join, still trading with us, and is a business (not staff).
export function listedOnTownPage(e: TownEngineer): boolean {
  return (
    Boolean(e.gasSafeVerifiedAt) &&
    Boolean(e.profilePublishedAt) &&
    e.liveTiers > 0 &&
    !e.leftAt &&
    !e.bannedAt &&
    !e.deletedAt &&
    !e.ownerId
  );
}

// Google penalises thin pages: a town is public only with at least one real
// engineer, and never while admin holds it.
export function townIsPublic(page: { heldAt: Date | null } | null, engineers: TownEngineer[]): boolean {
  if (page?.heldAt) return false;
  return engineers.some(listedOnTownPage);
}

// The Prisma filter matching listedOnTownPage, for queries.
export const LISTED_ENGINEER_WHERE = {
  gasSafeVerifiedAt: { not: null },
  profilePublishedAt: { not: null },
  tiers: { some: { status: "LIVE" as const } },
  leftAt: null,
  bannedAt: null,
  deletedAt: null,
  ownerId: null,
};

// A website partner: the widget has loaded on their site and admin hasn't
// switched it off.
export function isWebsitePartner(e: { websiteConnectedAt: Date | null; widgetDisabledAt: Date | null }): boolean {
  return Boolean(e.websiteConnectedAt) && !e.widgetDisabledAt;
}

// Town page order: website partners first, then by rating, then rating count.
export function townOrder<
  T extends { partner: boolean; average: number | null; count: number; name: string },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.partner) - Number(a.partner) ||
      (b.average ?? 0) - (a.average ?? 0) ||
      b.count - a.count ||
      a.name.localeCompare(b.name),
  );
}

export async function loadTown(townSlug: string) {
  const page = await prisma.townPage.findUnique({ where: { slug: townSlug } });
  const engineers = await prisma.engineer.findMany({
    where: { townSlug, ...LISTED_ENGINEER_WHERE },
    include: { tiers: { where: { status: "LIVE" }, select: { priceMonthlyPence: true } } },
  });
  const isPublic = townIsPublic(page, engineers.map((e) => ({ ...e, liveTiers: e.tiers.length })));
  return { page, engineers, isPublic };
}

// Sets publishedAt the first time a town goes public, so admin can see when.
export async function markTownPublished(townSlug: string, name: string) {
  await prisma.townPage.upsert({
    where: { slug: townSlug },
    update: {},
    create: { slug: townSlug, name, publishedAt: new Date() },
  });
  await prisma.townPage.updateMany({ where: { slug: townSlug, publishedAt: null }, data: { publishedAt: new Date() } });
}

// Every public town, for the sitemap.
export async function publicTownSlugs(): Promise<{ slug: string; updatedAt: Date }[]> {
  const rows = await prisma.engineer.groupBy({
    by: ["townSlug"],
    where: { townSlug: { not: null }, ...LISTED_ENGINEER_WHERE },
    _max: { updatedAt: true },
  });
  const held = new Set(
    (await prisma.townPage.findMany({ where: { heldAt: { not: null } }, select: { slug: true } })).map((t) => t.slug),
  );
  return rows
    .filter((r) => r.townSlug && !held.has(r.townSlug))
    .map((r) => ({ slug: r.townSlug!, updatedAt: r._max.updatedAt ?? new Date() }));
}
