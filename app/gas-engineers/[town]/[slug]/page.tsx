import { permanentRedirect } from "next/navigation";
import { queryString, type PageSearch } from "@/components/engineer-address";

export const dynamic = "force-dynamic";

// Section 6's town profile address. Since Review 4 the profile lives at the
// one address, tradesura.com/{slug}; links to the old one carry on there.
export default async function OldTownProfile({
  params,
  searchParams,
}: {
  params: Promise<{ town: string; slug: string }>;
  searchParams: Promise<PageSearch>;
}) {
  const { slug } = await params;
  permanentRedirect(`/${slug}${queryString({ ...(await searchParams) })}`);
}
