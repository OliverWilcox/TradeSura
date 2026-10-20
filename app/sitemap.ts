import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { profileUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

// Published engineer profiles (the app's "Get found on Google" step) with at
// least one live plan — the pages search engines are invited to index.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const engineers = await prisma.engineer.findMany({
    where: { profilePublishedAt: { not: null }, tiers: { some: { status: "LIVE" } } },
    select: { slug: true, updatedAt: true },
  });
  return [
    { url: appUrl(), changeFrequency: "weekly" },
    ...engineers.map((e) => ({ url: profileUrl(e.slug), lastModified: e.updatedAt, changeFrequency: "weekly" as const })),
  ];
}
