import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { EngineerPage, engineerPageMetadata, loadEngineerPage } from "@/components/engineer-page";
import { gasEngineerPath } from "@/lib/public-url";
import { isProfilePreview } from "@/lib/public-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return engineerPageMetadata(await loadEngineerPage(slug));
}

// tradesura.com/{slug} — the engineer's plan link and public profile until
// they have a town; then a permanent redirect to the town profile.
export default async function EngineerProfile({
  params,
  searchParams,
}: Params & {
  searchParams: Promise<{ src?: string; demo?: string; tier?: string; by?: string; preview?: string; practice?: string }>;
}) {
  const { slug } = await params;
  const { src, demo, tier, by, preview, practice } = await searchParams;
  const data = await loadEngineerPage(slug);
  if (!data) notFound();
  // Section 6 — profiles moved to /gas-engineers/{town}/{slug}; old links
  // (and any ?src=/tier= on them) keep working. /p/{slug} is not redirected.
  const previewOk = await isProfilePreview(preview, slug);
  // Review 4 — only a published profile (or the engineer's preview) moves on
  // to the town profile; until then this stays the plan page.
  if (data.engineer.townSlug && (data.engineer.profilePublishedAt || previewOk)) {
    const q = new URLSearchParams(
      Object.entries({ src, demo, tier, by, preview, practice }).filter((e): e is [string, string] => Boolean(e[1])),
    ).toString();
    permanentRedirect(`${gasEngineerPath(data.engineer.townSlug, slug)}${q ? `?${q}` : ""}`);
  }
  return (
    <EngineerPage
      data={data}
      slug={slug}
      src={src}
      demo={demo}
      tier={tier}
      by={by}
      preview={previewOk}
      practice={practice === "1"}
    />
  );
}
