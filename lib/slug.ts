import { prisma } from "@/lib/db";

// Top-level paths the app already owns. Engineer slugs now sit at the root
// (tradesura.com/{slug}), so a business can't be given one of these.
export const RESERVED_SLUGS = new Set([
  "admin", "api", "brand", "gas-engineers", "claim", "customer-terms", "embed", "embed-js", "favicon-ico",
  "join", "manifest-json", "p", "passport", "portal", "privacy", "r", "rate", "robots-txt", "s", "sitemap-xml", "terms",
  "about", "help", "login", "signin", "signup", "support", "tradesura", "www",
]);

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export async function uniqueSlug(base: string, excludeEngineerId?: string) {
  const root = slugify(base) || "engineer";
  let slug = RESERVED_SLUGS.has(root) ? `${root}-2` : root;
  for (let i = RESERVED_SLUGS.has(root) ? 3 : 2; ; i++) {
    const clash = await prisma.engineer.findUnique({ where: { slug } });
    if (!clash || clash.id === excludeEngineerId) return slug;
    slug = `${root}-${i}`;
  }
}
