import { prisma } from "@/lib/db";

// Top-level paths the app already owns. Engineer slugs now sit at the root
// (tradesura.com/{slug}), so a business can't be given one of these.
// Review 4 adds the app words Matt listed and the routes added since.
export const RESERVED_SLUGS = new Set([
  "admin", "api", "brand", "gas-engineers", "claim", "customer-terms", "embed", "embed-js", "favicon-ico",
  "join", "manifest-json", "p", "passport", "portal", "privacy", "r", "rate", "robots-txt", "s", "sitemap-xml", "terms",
  "about", "help", "login", "signin", "signup", "support", "tradesura", "www",
  "c", "u", "rejoin", "assets", "logout", "sign-in", "sign-up", "register", "account", "settings", "dashboard",
  "app", "contact", "faq", "pricing", "blog", "news", "shop", "careers", "legal", "cookies", "unsubscribe",
  "auth", "verify", "status", "engineers", "installers", "towns", "how-it-works", "home", "index", "public", "static",
]);

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export async function uniqueSlug(base: string, excludeEngineerId?: string) {
  const root = slugify(base) || "engineer";
  let slug = RESERVED_SLUGS.has(root) ? `${root}-2` : root;
  for (let i = RESERVED_SLUGS.has(root) ? 3 : 2; ; i++) {
    const clash = await prisma.engineer.findFirst({
      where: { OR: [{ slug }, { previousSlugs: { has: slug } }] },
      select: { id: true },
    });
    if (!clash || clash.id === excludeEngineerId) return slug;
    slug = `${root}-${i}`;
  }
}

// Review 4 — what the engineer may pick as their address: 3–40 letters,
// numbers and dashes, not an app word, not someone else's (current or old).
export async function checkChosenSlug(input: string, engineerId: string): Promise<{ slug: string } | { error: string }> {
  const slug = slugify(input);
  if (slug.length < 3) return { error: "Use at least 3 letters or numbers." };
  if (RESERVED_SLUGS.has(slug)) return { error: `tradesura.com/${slug} is kept for TradeSura — try another.` };
  const clash = await prisma.engineer.findFirst({
    where: { id: { not: engineerId }, OR: [{ slug }, { previousSlugs: { has: slug } }] },
    select: { id: true },
  });
  if (clash) return { error: `tradesura.com/${slug} is taken — try ${slug}-2 or add your town.` };
  return { slug };
}

/** Data for moving an engineer to a new address; the old one keeps redirecting. */
export function moveSlug(current: { slug: string; previousSlugs: string[] }, next: string) {
  if (next === current.slug) return { slug: next };
  return { slug: next, previousSlugs: [...new Set([...current.previousSlugs.filter((s) => s !== next), current.slug])] };
}

/** The engineer's current address when {slug} is one they used to have. */
export async function currentSlugFor(oldSlug: string): Promise<string | null> {
  const e = await prisma.engineer.findFirst({ where: { previousSlugs: { has: oldSlug } }, select: { slug: true } });
  return e?.slug ?? null;
}
