import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { canonicalProfileUrl, townPageUrl } from "@/lib/public-url";
import { publicTownSlugs } from "@/lib/town";

export const dynamic = "force-dynamic";

// Published engineer profiles (the app's "Get found on Google" step) with at
// least one live plan, at their canonical address (the town profile once
// they have a town), plus every public town page (Section 6).
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const engineers = await prisma.engineer.findMany({
    where: {
      profilePublishedAt: { not: null },
      tiers: { some: { status: "LIVE" } },
      leftAt: null,
      deletedAt: null,
    },
    select: { slug: true, townSlug: true, updatedAt: true },
  });
  const towns = await publicTownSlugs();
  return [
    { url: appUrl(), changeFrequency: "weekly" },
    ...towns.map((t) => ({ url: townPageUrl(t.slug), lastModified: t.updatedAt, changeFrequency: "weekly" as const })),
    ...engineers.map((e) => ({
      url: canonicalProfileUrl(e),
      lastModified: e.updatedAt,
      changeFrequency: "weekly" as const,
    })),
  ];
}
