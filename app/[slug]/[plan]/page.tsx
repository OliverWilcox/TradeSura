import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { engineerPageMetadata, loadEngineerPage } from "@/components/engineer-page";
import { queryString, renderEngineerPage, type PageSearch } from "@/components/engineer-address";
import { tierForPlanSlug } from "@/lib/plan-slugs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; plan: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return engineerPageMetadata(await loadEngineerPage(slug), { profile: true });
}

// Review 4 — one plan's own link: tradesura.com/{slug}/{plan} opens the
// business page with that plan chosen. A plan that's gone (renamed, retired)
// falls back to the business page rather than a dead end.
export default async function PlanAddress({ params, searchParams }: Params & { searchParams: Promise<PageSearch> }) {
  const { slug, plan } = await params;
  const q = await searchParams;
  const data = await loadEngineerPage(slug);
  if (data) {
    const tier = tierForPlanSlug(data.tiers, plan);
    if (!tier) permanentRedirect(`/${slug}${queryString({ ...q })}`);
    return renderEngineerPage(slug, q, { planSlug: plan, tierId: tier.id });
  }
  return renderEngineerPage(slug, q, { planSlug: plan });
}
