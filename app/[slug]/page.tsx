import type { Metadata } from "next";
import { engineerPageMetadata, loadEngineerPage } from "@/components/engineer-page";
import { renderEngineerPage, type PageSearch } from "@/components/engineer-address";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return engineerPageMetadata(await loadEngineerPage(slug), { profile: true });
}

// Review 4 (Matt's decision) — one address everywhere: tradesura.com/{slug}.
export default async function EngineerAddress({ params, searchParams }: Params & { searchParams: Promise<PageSearch> }) {
  const { slug } = await params;
  return renderEngineerPage(slug, await searchParams);
}
