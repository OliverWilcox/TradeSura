import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { EngineerPage, engineerPageMetadata, loadEngineerPage } from "@/components/engineer-page";
import { publicRatings, ratingSummary } from "@/lib/ratings";
import { isWebsitePartner } from "@/lib/town";
import { gasEngineerPath } from "@/lib/public-url";
import { isProfilePreview, profileVisible } from "@/lib/public-page";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ town: string; slug: string }> };
type Search = {
  searchParams: Promise<{ src?: string; demo?: string; tier?: string; by?: string; preview?: string; practice?: string }>;
};

async function load(slug: string) {
  const data = await loadEngineerPage(slug);
  // An installer who has left, or a deleted account, has no public profile.
  if (!data || data.engineer.leftAt || data.engineer.deletedAt) return null;
  return data;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  return engineerPageMetadata(await load(slug), { profile: true });
}

function query(q: Record<string, string | undefined>): string {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return s ? `?${s}` : "";
}

// Section 6 — tradesura.com/gas-engineers/{town}/{slug}: the installer's
// profile, server-rendered for Google. Same page as the plan link, plus
// rating, Call/Message, photos and the recruitment banner.
export default async function GasEngineerProfile({ params, searchParams }: Params & Search) {
  const { town, slug } = await params;
  const q = await searchParams;
  const data = await load(slug);
  if (!data) notFound();
  const { engineer } = data;
  if (!engineer.townSlug) permanentRedirect(`/${slug}${query(q)}`);
  if (engineer.townSlug !== town) permanentRedirect(`${gasEngineerPath(engineer.townSlug, slug)}${query(q)}`);
  // Review 4 — an unpublished profile isn't public. Visitors get the plan
  // link instead (Stripe's business URL lands here, so never a 404); only
  // the engineer's own preview link shows the profile before it's published.
  const preview = await isProfilePreview(q.preview, slug);
  if (!profileVisible(Boolean(engineer.profilePublishedAt), preview)) {
    redirect(`/p/${slug}${query({ ...q, preview: undefined })}`);
  }

  const [rating, ratings] = await Promise.all([ratingSummary(engineer.id), publicRatings(engineer.id, 20)]);
  return (
    <EngineerPage
      data={data}
      slug={slug}
      src={q.src}
      demo={q.demo}
      tier={q.tier}
      by={q.by}
      preview={preview}
      practice={q.practice === "1"}
      profile={{ rating, ratings, partner: isWebsitePartner(engineer) }}
    />
  );
}
