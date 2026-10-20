import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { RESERVED_SLUGS } from "@/lib/slug";
import { EngineerPage, engineerPageMetadata, loadEngineerPage } from "@/components/engineer-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return engineerPageMetadata(await loadEngineerPage(slug));
}

// The old plan-link address. Printed QR stickers, texts and Stripe's
// business URL still point here, so it forwards to tradesura.com/{slug} —
// except for the odd older slug that a top-level route now shadows, which
// keeps rendering here.
export default async function LegacyPlanPage({
  params,
  searchParams,
}: Params & { searchParams: Promise<{ src?: string; demo?: string; tier?: string; by?: string }> }) {
  const { slug } = await params;
  const query = await searchParams;
  if (!RESERVED_SLUGS.has(slug)) {
    const qs = new URLSearchParams(
      Object.entries(query).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    permanentRedirect(`/${slug}${qs ? `?${qs}` : ""}`);
  }
  const data = await loadEngineerPage(slug);
  if (!data) notFound();
  return (
    <EngineerPage data={data} slug={slug} src={query.src} demo={query.demo} tier={query.tier} by={query.by} />
  );
}
