import { slugify } from "@/lib/slug";

// Review 4 — each plan has its own link hanging off the business address:
// tradesura.com/mwheating/boiler-care. Derived from the plan's name in the
// engineer's own order, so two plans called the same get -2, -3. Words the
// business address uses for its own pages never become a plan link.
const RESERVED_PLAN_SLUGS = new Set(["signup", "plans", "join", "embed", "preview"]);

export function planSlugs(tiers: { id: string; name: string }[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const t of tiers) {
    const root = slugify(t.name) || "plan";
    let slug = RESERVED_PLAN_SLUGS.has(root) ? `${root}-2` : root;
    for (let i = 2; taken.has(slug); i++) slug = `${root}-${i}`;
    taken.add(slug);
    out.set(t.id, slug);
  }
  return out;
}

/** The tier a plan link names, or null when no live plan has that link. */
export function tierForPlanSlug<T extends { id: string; name: string }>(tiers: T[], planSlug: string): T | null {
  const slugs = planSlugs(tiers);
  return tiers.find((t) => slugs.get(t.id) === planSlug.toLowerCase()) ?? null;
}
