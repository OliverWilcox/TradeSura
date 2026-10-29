import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EngineerPage, engineerPageMetadata, loadEngineerPage } from "@/components/engineer-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return engineerPageMetadata(await loadEngineerPage(slug));
}

// Review 3 — the plan link: tradesura.com/p/{slug}. Same engineer page as
// the profile at tradesura.com/{slug}; QR stickers, texts and Stripe's
// business URL all land here.
export default async function PlanLinkPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ src?: string; demo?: string; tier?: string; by?: string; rejoin?: string; practice?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  const data = await loadEngineerPage(slug);
  if (!data) notFound();
  return (
    <EngineerPage data={data} slug={slug} src={query.src} demo={query.demo} tier={query.tier} by={query.by} rejoin={query.rejoin} practice={query.practice === "1"} />
  );
}
