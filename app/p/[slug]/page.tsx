import { permanentRedirect } from "next/navigation";
import { queryString, type PageSearch } from "@/components/engineer-address";

export const dynamic = "force-dynamic";

// Review 4 — one address everywhere: the old plan link tradesura.com/p/{slug}
// (QR stickers, texts already sent) moves to tradesura.com/{slug}, keeping
// any ?src=, ?tier= or ?rejoin= on it. The sign-up steps under
// /p/{slug}/signup/… keep working for links already sent.
export default async function OldPlanLink({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<PageSearch>;
}) {
  const { slug } = await params;
  permanentRedirect(`/${slug}${queryString({ ...(await searchParams) })}`);
}
