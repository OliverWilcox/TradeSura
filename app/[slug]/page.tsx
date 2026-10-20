import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EngineerPage, engineerPageMetadata, loadEngineerPage } from "@/components/engineer-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return engineerPageMetadata(await loadEngineerPage(slug));
}

// tradesura.com/{slug} — the engineer's plan link and public profile.
export default async function EngineerProfile({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ src?: string; demo?: string; tier?: string; by?: string }> }) {
  const { slug } = await params;
  const { src, demo, tier, by } = await searchParams;
  const data = await loadEngineerPage(slug);
  if (!data) notFound();
  return <EngineerPage data={data} slug={slug} src={src} demo={demo} tier={tier} by={by} />;
}
