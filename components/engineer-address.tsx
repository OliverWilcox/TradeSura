import { notFound, permanentRedirect } from "next/navigation";
import { EngineerPage, loadEngineerPage } from "@/components/engineer-page";
import { isProfilePreview, profileVisible } from "@/lib/public-page";
import { publicRatings, ratingSummary } from "@/lib/ratings";
import { isWebsitePartner } from "@/lib/town";
import { currentSlugFor } from "@/lib/slug";

export type PageSearch = {
  src?: string;
  demo?: string;
  tier?: string;
  by?: string;
  preview?: string;
  practice?: string;
  rejoin?: string;
  /** 30 Oct §6 — the at-the-job offer this page was opened from. */
  o?: string;
  /** 30 Oct §7.9 — a neighbour's referral (their plan ref). */
  nref?: string;
};

export function queryString(q: Record<string, string | undefined>): string {
  const s = new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  return s ? `?${s}` : "";
}

// Review 4 (Matt's decision) — one address everywhere: tradesura.com/{slug}
// is the business's page. It always lists the plans; once the profile is
// published (or the engineer previews it) it also carries the profile:
// Verified Member badge, Call/Message, photos, ratings and the Google
// heading. An address the business used to have redirects here.
export async function renderEngineerPage(slug: string, q: PageSearch, opts: { planSlug?: string; tierId?: string } = {}) {
  const data = await loadEngineerPage(slug);
  if (!data) {
    const moved = await currentSlugFor(slug);
    if (moved) permanentRedirect(`/${moved}${opts.planSlug ? `/${opts.planSlug}` : ""}${queryString({ ...q })}`);
    notFound();
  }
  const { engineer } = data;
  const preview = await isProfilePreview(q.preview, slug);
  const showProfile =
    !engineer.leftAt && !engineer.deletedAt && profileVisible(Boolean(engineer.profilePublishedAt), preview);
  const [rating, ratings] = showProfile
    ? await Promise.all([ratingSummary(engineer.id), publicRatings(engineer.id, 20)])
    : [null, []];
  return (
    <EngineerPage
      data={data}
      slug={slug}
      src={q.src}
      demo={q.demo}
      tier={opts.tierId ?? q.tier}
      by={q.by}
      rejoin={q.rejoin}
      offer={q.o}
      nref={q.nref}
      preview={preview}
      practice={q.practice === "1"}
      profile={showProfile && rating ? { rating, ratings, partner: isWebsitePartner(engineer) } : undefined}
    />
  );
}
