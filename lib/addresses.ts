import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";
import { UK_POSTCODE, normalisePostcode } from "@/lib/validate";
import { townSlugOf } from "@/lib/town";

// An engineer's three addresses (client feedback, engineer record 1):
// - trading: where they work from. It sets their home town and town page, so
//   Engineer.postcode, town and townSlug follow it. Kept in
//   EngineerTradingAddress.
// - correspondence: where the member pack and all post go. It's
//   Engineer.packAddress, and "the same as trading" until someone changes it.
// - registered office: Companies House's, for legal details only. Never
//   stored; lib/admin/companies.ts looks it up.
// Sign-up, the engineer's settings and the admin all save through
// saveAddresses(), so those fields can't drift apart.

export type PostalAddress = { lines: string[]; town: string; postcode: string };

/** One address as a form sends it: up to three street lines, a town and a UK postcode. */
export const AddressInput = z
  .strictObject({
    lines: z
      .array(z.string().trim().max(160))
      .max(3)
      .transform((ls) => ls.filter(Boolean))
      .pipe(z.array(z.string()).min(1)),
    town: z.string().trim().min(1).max(80),
    postcode: z.string().max(10).transform(normalisePostcode).pipe(z.string().regex(UK_POSTCODE)),
  })
  .refine((a) => townSlugOf(a.town) !== "", { path: ["town"], message: "Enter the town's name." });

/** Each line, then the town, then the postcode: the shape sign-up saves the pack address in. */
export function formatAddress(a: PostalAddress): string {
  return [...a.lines, a.town, a.postcode]
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

const POSTCODE_IN_TEXT = /([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})/i;

/** The postcode in some address text, without its space ("E16 1YL" → "E161YL"). */
export function postcodeOf(text: string | null | undefined): string | null {
  const m = text?.match(POSTCODE_IN_TEXT);
  return m ? `${m[1]}${m[2]}`.toUpperCase() : null;
}

/** Whether two addresses are written the same, ignoring case, spacing and punctuation. */
export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(a && b) && key(a!) === key(b!);
}

/**
 * Address text (sign-up's "line\ntown\npostcode", or what the engineer typed
 * for their pack) split up: the postcode at the end, the town before it, the
 * rest as street lines. Null without a postcode or a street line.
 */
export function parseAddress(text: string | null | undefined): PostalAddress | null {
  if (!text) return null;
  const parts = text
    .split(/[\n,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  // The postcode can share its line with the town ("Holmfirth HD9 2TT").
  const m = parts.pop()?.match(/^(.*?)\s*([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i);
  if (!m) return null;
  if (m[1]) parts.push(m[1]);
  const town = parts.pop();
  if (!town || !parts.length) return null;
  return { lines: parts, town, postcode: normalisePostcode(m[2]) };
}

export type AddressSource = "signup" | "engineer" | "admin";

type TradingRow = { lines: string[]; town: string; postcode: string; source: string; updatedAt: Date; updatedByName: string | null };

export type TradingAddress = PostalAddress & {
  /** Who saved it; null while it's only read from the pack address. */
  source: AddressSource | null;
  updatedAt: Date | null;
  updatedByName: string | null;
};

/** The trading address as saved or, until it is, the address the engineer gave for their pack. */
export function tradingAddressOf(row: TradingRow | null, packAddress: string | null): TradingAddress | null {
  if (row) {
    return { lines: row.lines, town: row.town, postcode: row.postcode, source: row.source as AddressSource, updatedAt: row.updatedAt, updatedByName: row.updatedByName };
  }
  const parsed = parseAddress(packAddress);
  return parsed ? { ...parsed, source: null, updatedAt: null, updatedByName: null } : null;
}

/**
 * Save an engineer's trading address and where their post goes. "same"
 * sends post to the trading address, an address sends it there, and leaving
 * it out keeps it, unless it was the same as the old trading address (or
 * there's none yet), when it follows. Postcode, town and town page follow the
 * trading address, the way ensureEngineerTown (lib/town.ts) sets them.
 */
export async function saveAddresses(
  db: Prisma.TransactionClient,
  engineerId: string,
  input: { trading: PostalAddress; correspondence?: PostalAddress | "same" },
  by: { source: AddressSource; id?: string; name?: string },
) {
  const [e, before] = await Promise.all([
    db.engineer.findUniqueOrThrow({ where: { id: engineerId }, select: { town: true, packAddress: true } }),
    db.engineerTradingAddress.findUnique({ where: { engineerId } }),
  ]);
  const { trading, correspondence } = input;
  const follows = correspondence === "same" || (correspondence === undefined && (!e.packAddress || !before || sameAddress(e.packAddress, formatAddress(before))));
  const packAddress = follows ? formatAddress(trading) : correspondence ? formatAddress(correspondence as PostalAddress) : e.packAddress;
  const townSlug = townSlugOf(trading.town);
  if (!townSlug) throw new Error("A trading address needs a town.");
  const saved = { lines: trading.lines, town: trading.town, postcode: trading.postcode, source: by.source, updatedById: by.id ?? null, updatedByName: by.name ?? null };
  await db.engineerTradingAddress.upsert({ where: { engineerId }, create: { engineerId, ...saved }, update: saved });
  await db.engineer.update({ where: { id: engineerId }, data: { postcode: trading.postcode, town: trading.town, townSlug, packAddress } });
  await db.townPage.upsert({ where: { slug: townSlug }, update: {}, create: { slug: townSlug, name: trading.town } });
  return {
    townBefore: e.town,
    town: trading.town,
    townSlug,
    packAddressChanged: !sameAddress(packAddress, e.packAddress),
    correspondenceSameAsTrading: sameAddress(packAddress, formatAddress(trading)),
  };
}
