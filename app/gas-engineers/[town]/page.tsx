import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EMERGENCY_LINE } from "@/lib/compliance/interlock";
import { brandName } from "@/lib/engineer";
import { ratingSummary } from "@/lib/ratings";
import { isWebsitePartner, loadTown, markTownPublished, townOrder } from "@/lib/town";
import { gasEngineerPath, townPageUrl } from "@/lib/public-url";
import { RingMark } from "@/components/ring-mark";
import { PartnerBadge, RatingLine, RecruitBanner } from "@/components/engineer-profile";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ town: string }> };

const pounds = (pence: number) => (pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`);

function townName(page: { name: string } | null, engineers: { town: string | null }[], slug: string): string {
  return page?.name || engineers.find((e) => e.town)?.town || slug;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { town } = await params;
  const { page, engineers, isPublic } = await loadTown(town);
  if (!isPublic) return { title: "Gas engineers", robots: { index: false, follow: false } };
  const name = townName(page, engineers, town);
  const from = Math.min(...engineers.flatMap((e) => e.tiers.map((t) => t.priceMonthlyPence)));
  const n = engineers.length;
  return {
    title: { absolute: `Gas engineers in ${name} | TradeSura` },
    description: `${n} Gas Safe verified gas engineer${n === 1 ? "" : "s"} in ${name} on TradeSura. Boiler care plans from ${pounds(from)} a month, ratings from verified customers.`,
    alternates: { canonical: townPageUrl(town) },
  };
}

// Section 6 — tradesura.com/gas-engineers/{town}. Only public once the town
// has a real engineer (verified, published profile, live plan) and admin
// isn't holding it; Google penalises thin pages. Content is our own data.
export default async function TownPage({ params }: Params) {
  const { town } = await params;
  const { page, engineers, isPublic } = await loadTown(town);
  if (!isPublic) notFound();
  const name = townName(page, engineers, town);
  if (!page?.publishedAt) await markTownPublished(town, name);

  const rows = townOrder(
    await Promise.all(
      engineers.map(async (e) => {
        const rating = await ratingSummary(e.id);
        const prices = e.tiers.map((t) => t.priceMonthlyPence);
        return {
          id: e.id,
          slug: e.slug,
          townSlug: e.townSlug!,
          name: brandName(e),
          area: e.serviceArea?.trim() || null,
          partner: isWebsitePartner(e),
          rating,
          average: rating.isNew ? null : rating.average,
          count: rating.count,
          fromPence: Math.min(...prices),
        };
      }),
    ),
  );

  const allPrices = engineers.flatMap((e) => e.tiers.map((t) => t.priceMonthlyPence)).sort((a, b) => a - b);
  const from = allPrices[0];
  const typical = allPrices[Math.floor((allPrices.length - 1) / 2)];
  const ratingCount = rows.reduce((n, r) => n + r.count, 0);
  const n = rows.length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Gas engineers in ${name}`,
    itemListElement: rows.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${townPageUrl(town)}/${r.slug}`,
      name: r.name,
    })),
  };

  return (
    <div className="flex-1 flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <header className="bg-paper px-4 pt-4 pb-3 border-b border-line-soft">
        <Link href="/" className="flex items-center gap-2">
          <RingMark size={20} />
          <span className="font-disp text-base font-bold tracking-wide">TradeSura</span>
        </Link>
      </header>
      <main className="flex-1 flex flex-col gap-3.5 px-4 py-4">
        <div>
          <h1 className="font-sans font-bold text-xl">Gas engineers in {name}</h1>
          <p className="text-sm text-muted mt-1">
            {n} Gas Safe verified engineer{n === 1 ? "" : "s"} on TradeSura · care plans from{" "}
            <b className="text-ink">{pounds(from)}</b> a month
          </p>
        </div>

        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={gasEngineerPath(r.townSlug, r.slug)}
                className="block bg-paper border border-line rounded-xl p-3.5 hover:border-line-strong"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[15px]">{r.name}</span>
                  {r.partner && <PartnerBadge />}
                </div>
                <div className="mt-1 text-[12.5px] text-muted">
                  <RatingLine rating={r.rating} short /> · plans from{" "}
                  <span className="font-semibold text-ink">{pounds(r.fromPence)}/mo</span>
                </div>
                {r.area && <p className="mt-1 text-[12px] text-faint">Covers {r.area}</p>}
              </Link>
            </li>
          ))}
        </ul>

        <div className="bg-paper border border-line rounded-xl p-3.5 text-[13px] text-muted">
          <h2 className="font-sans font-semibold text-sm text-ink mb-1">Boiler care plans in {name}</h2>
          <p>
            A typical plan here costs {pounds(typical)} a month, paid by Direct Debit, with a 14-day
            cooling-off period and no minimum term.
            {ratingCount > 0 &&
              ` Engineers in ${name} have ${ratingCount} rating${ratingCount === 1 ? "" : "s"} from verified TradeSura customers.`}{" "}
            Every engineer listed is on the Gas Safe Register, checked by us.
          </p>
        </div>

        <RecruitBanner href="/" text={`Are you a gas engineer in ${name}? Join the ${n} already here`} />
      </main>
      <footer className="font-mono text-[10px] text-faint text-center px-4 py-3 space-y-1">
        <p>
          Smell gas? Call the National Gas Emergency line free:{" "}
          <a href="tel:0800111999" className="font-semibold text-ink">
            {EMERGENCY_LINE}
          </a>
        </p>
        <p>
          TradeSura ·{" "}
          <Link href="/terms" className="underline">
            Terms &amp; privacy
          </Link>
        </p>
      </footer>
    </div>
  );
}
