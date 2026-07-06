import { prisma } from "@/lib/db";

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export async function uniqueSlug(base: string, excludeEngineerId?: string) {
  const root = slugify(base) || "engineer";
  let slug = root;
  for (let i = 2; ; i++) {
    const clash = await prisma.engineer.findUnique({ where: { slug } });
    if (!clash || clash.id === excludeEngineerId) return slug;
    slug = `${root}-${i}`;
  }
}
