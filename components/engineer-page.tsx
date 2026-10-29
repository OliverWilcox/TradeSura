import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { verifyGasSafe } from "@/lib/gas-safe";
import { clauseLine } from "@/lib/clauses";
import { canonicalProfileUrl, profileUrl } from "@/lib/public-url";
import { tradingNameOf } from "@/lib/engineer";
import type { PublicRating } from "@/lib/ratings";
import { CustomerShell } from "@/components/shells";
import { PublicSignup } from "@/components/public-signup";
import { ProfileContact } from "@/components/profile-contact";
import { rejoinFreeMonth } from "@/lib/rejoin-offer";
import { pageMode } from "@/lib/public-page";
import { TrustLine } from "@/components/verified-badge";
import {
  ProfileHeader,
  ProfilePhotos,
  RatingsList,
  RecruitBanner,
  type RatingSummary,
} from "@/components/engineer-profile";

// The engineer's public page — tradesura.com/{slug}. One page is both the
// plan link (customers pick a plan and join) and, once published from the
// app's "Get found on Google" step, an indexable profile: about, areas
// covered, Gas Safe status, and LocalBusiness structured data.

export async function loadEngineerPage(slug: string) {
  const engineer = await prisma.engineer.findUnique({ where: { slug } });
  if (!engineer || !engineer.tradingName) return null;
  const tiers = await prisma.planTier.findMany({
    where: { engineerId: engineer.id, status: "LIVE" },
    orderBy: { sortOrder: "asc" },
    include: { clauses: { include: { clause: true } } },
  });
  return { engineer, tiers };
}

type Loaded = NonNullable<Awaited<ReturnType<typeof loadEngineerPage>>>;

export function engineerPageMetadata(data: Loaded | null, opts: { profile?: boolean } = {}): Metadata {
  if (!data) return { title: "Care plans" };
  const { engineer } = data;
  const area = engineer.serviceArea?.trim();
  const published = Boolean(engineer.profilePublishedAt);
  const town = engineer.town?.trim();
  if (opts.profile && town) {
    // Section 6 — "Dave's Heating: Gas Engineer in Huddersfield | TradeSura".
    return {
      title: { absolute: `${engineer.tradingName}: Gas Engineer in ${town} | TradeSura` },
      description: (
        engineer.profileBio?.trim() ||
        `${engineer.tradingName} is a Gas Safe registered engineer in ${town}${area ? ` covering ${area}` : ""}. Boiler care plans paid monthly by Direct Debit, ratings from verified customers, call or message direct.`
      ).slice(0, 160),
      alternates: { canonical: canonicalProfileUrl(engineer) },
      robots: published ? { index: true, follow: true } : { index: false, follow: false },
    };
  }
  return {
    title: area
      ? `${engineer.tradingName} — boiler care plans in ${area}`
      : `${engineer.tradingName} Care Plans`,
    description:
      engineer.profileBio?.trim().slice(0, 160) ||
      `Monthly boiler care plans from ${engineer.tradingName}, a Gas Safe registered engineer${area ? ` covering ${area}` : ""}.`,
    alternates: { canonical: canonicalProfileUrl(engineer) },
    // Plan links work from day one; search engines only see a profile the
    // engineer has chosen to publish.
    robots: published ? { index: true, follow: true } : { index: false, follow: false },
  };
}

const FAQS: { q: string; a: string }[] = [
  {
    q: "What's included?",
    a: "Whatever your chosen plan lists — priority booking is in every plan. Every service and check on your plan is carried out by your own engineer.",
  },
  {
    q: "What's not included?",
    a: "Breakdown repairs. If something breaks you get priority and your plan discount on the work — this is a maintenance and priority agreement, not an insurance policy.",
  },
  {
    q: "When is my service?",
    a: "If your plan includes the annual service, it's available once your third monthly payment has been collected — or, if you pay yearly, from the start of your third plan month. Your engineer sets your service month and messages you to book it in.",
  },
  {
    q: "How do I cancel?",
    a: "Two taps from your plan page, confirmed by email. No phone calls, no notice period, no hoops. There's also a 14-day cooling-off period when you join.",
  },
  {
    q: "Who is TradeSura?",
    a: "The platform your engineer uses to run care plans and collect payments by Direct Debit. Your plan and your relationship are with your engineer; TradeSura just handles the rails.",
  },
];

// Section 6 — what the Google-facing profile at
// /gas-engineers/{town}/{slug} adds on top of the plan page.
export type ProfileExtras = {
  rating: RatingSummary;
  ratings: PublicRating[];
  partner: boolean;
};

export async function EngineerPage({
  data,
  slug,
  src,
  demo,
  tier,
  by,
  profile,
  rejoin,
  preview = false,
  practice = false,
}: {
  data: Loaded;
  slug: string;
  src?: string;
  demo?: string;
  tier?: string;
  /** Staff engineer handing over their phone (team accounts, demo only). */
  by?: string;
  profile?: ProfileExtras;
  /** Retention §9 — a win-back rejoin link's token. */
  rejoin?: string;
  /** Review 4 — the engineer's own "Preview my profile" link (checked by the route). */
  preview?: boolean;
  /** Review 4 — demo mode while offers are locked: nothing is saved. */
  practice?: boolean;
}) {
  const { engineer, tiers } = data;
  const brand = engineer.tradingName!;
  const bio = engineer.profileBio?.trim();
  const area = engineer.serviceArea?.trim();
  const published = Boolean(engineer.profilePublishedAt);
  const legalLine = tradingNameOf(engineer);
  const mode = pageMode({ preview, practice, engineer });
  const banner = <ModeBanner mode={mode} />;

  // The engineer's Stripe Connect business_profile.url points here from the
  // moment they connect payments — before they've published a plan. A hard
  // 404 in that gap makes Stripe flag the account for an unreachable
  // website, so this renders an honest holding page instead.
  if (tiers.length === 0) {
    return (
      <CustomerShell tradingName={brand} legalLine={legalLine}>
        {banner}
        <div className="bg-paper border border-line rounded-xl p-4 text-center">
          <h1 className="font-sans font-semibold text-base mb-1.5">{brand}&apos;s care plans</h1>
          <p className="text-sm text-muted">
            Monthly boiler care plans from a Gas Safe registered engineer. Plans are being set up
            now; check back soon, or ask {brand} directly.
          </p>
        </div>
      </CustomerShell>
    );
  }

  // Live Gas Safe check — the badge shows register data queried now, not a
  // value cached at signup.
  const registerMatch = engineer.gasSafeNo ? await verifyGasSafe(engineer.gasSafeNo) : null;
  // Verification is a human decision in the admin queue (29 Sept review):
  // an approved, standing engineer shows the badge even when their number
  // isn't in our copy of the register.
  const gasSafe =
    registerMatch ?? (engineer.gasSafeVerifiedAt && !engineer.pausedAt && !engineer.bannedAt ? true : null);

  await track("page_visit", { type: "CUSTOMER" }, {
    engineerId: engineer.id,
    slug,
    source: mode === "preview" || mode === "practice" ? mode : demo ? "demo" : (src ?? (profile ? "profile" : "direct")),
  });

  const rated = profile && profile.rating.average !== null && profile.rating.count > 0 ? profile.rating : null;
  const jsonLd = published && mode !== "preview" && mode !== "practice"
    ? {
        "@context": "https://schema.org",
        "@type": profile ? ["LocalBusiness", "HVACBusiness"] : "HVACBusiness",
        name: brand,
        url: profile ? canonicalProfileUrl(engineer) : profileUrl(engineer.slug),
        ...(engineer.legalName?.trim() ? { legalName: engineer.legalName.trim() } : {}),
        ...(engineer.logoUrl ? { image: engineer.logoUrl } : {}),
        ...(bio ? { description: bio } : {}),
        ...(area ? { areaServed: area } : {}),
        ...(profile && engineer.town ? { address: { "@type": "PostalAddress", addressLocality: engineer.town, addressCountry: "GB" } } : {}),
        ...(profile && engineer.profilePhotos.length ? { photo: engineer.profilePhotos } : {}),
        // Only when ratings exist — Google ignores (and can penalise) empty ones.
        ...(rated
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: rated.average!.toFixed(1),
                reviewCount: rated.count,
                bestRating: 5,
                worstRating: 1,
              },
              review: profile!.ratings.slice(0, 5).map((r) => ({
                "@type": "Review",
                reviewRating: { "@type": "Rating", ratingValue: r.stars, bestRating: 5, worstRating: 1 },
                author: { "@type": "Person", name: r.customerName ?? "Verified TradeSura customer" },
                datePublished: r.ratedAt.toISOString().slice(0, 10),
                ...(r.comment ? { reviewBody: r.comment } : {}),
              })),
            }
          : {}),
        makesOffer: tiers.map((t) => ({
          "@type": "Offer",
          name: t.name,
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: (t.priceMonthlyPence / 100).toFixed(2),
            priceCurrency: "GBP",
            ...(engineer.vatRegistered ? { valueAddedTaxIncluded: true } : {}),
            unitText: "MONTH",
          },
        })),
      }
    : null;

  return (
    <CustomerShell
      tradingName={brand}
      legalLine={legalLine}
      // Build Guide v2 Part 15.1 — the trust line. Never asserted for an
      // engineer who isn't actually verified.
      sub={<TrustLine verified={Boolean(gasSafe)} />}
    >
      {banner}
      {jsonLd && (
        <script
          type="application/ld+json"
          // JSON.stringify output, with "<" escaped so text can't close the tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
        />
      )}

      {profile && (
        <>
          <ProfileHeader
            brand={brand}
            logoUrl={engineer.logoUrl}
            town={engineer.town}
            verified={Boolean(gasSafe)}
            partner={profile.partner}
            rating={profile.rating}
          />
          {!engineer.leftAt && (
            <ProfileContact
              slug={engineer.slug}
              firstName={engineer.firstName?.trim() || brand}
              brand={brand}
              tel={engineer.enquiryPhone || engineer.phone}
              showCall={engineer.showCallButton}
              showMessage={engineer.showMessageButton}
            />
          )}
          {bio && <p className="text-[13.5px] text-muted whitespace-pre-line px-0.5">{bio}</p>}
          <ProfilePhotos photos={engineer.profilePhotos} brand={brand} />
        </>
      )}

      {!profile && (bio || area) && (
        <div className="bg-paper border border-line rounded-xl p-3.5">
          <h1 className="font-sans font-semibold text-sm mb-1">About {brand}</h1>
          {bio && <p className="text-[13px] text-muted whitespace-pre-line">{bio}</p>}
          {area && (
            <p className="text-[12.5px] text-muted mt-2">
              <span className="font-semibold text-ink">Areas covered:</span> {area}
            </p>
          )}
        </div>
      )}

      {/* Build Guide v2 Part 15.1 — title + sub-line, verbatim. */}
      <div>
        <h2 className="font-sans font-semibold text-lg">Choose your plan</h2>
        <p className="text-sm text-muted">Cancel anytime — set up takes about a minute.</p>
      </div>

      <PublicSignup
        slug={slug}
        engineerName={brand}
        vatRegistered={engineer.vatRegistered}
        initialTierId={tier}
        rejoin={rejoin}
        firstMonthFree={await rejoinFreeMonth(engineer.id, rejoin)}
        mode={mode}
        soldById={demo ? by : undefined}
        channel={
          demo ? "demo" : src === "blast" ? "blast" : src === "referral" ? "referral" : src === "website" ? "website" : "web"
        }
        tiers={tiers.map((t) => ({
          id: t.id,
          name: t.name,
          priceMonthlyPence: t.priceMonthlyPence,
          isRecommended: t.isRecommended,
          lines: [
            ...t.clauses
              .sort((a, b) => a.clause.sortOrder - b.clause.sortOrder)
              .map((tc) => clauseLine(tc.clause, t.clauseRates)),
            ...t.customLabels,
          ],
        }))}
      />

      {profile && area && (
        <div className="bg-paper border border-line rounded-xl p-3.5">
          <h2 className="font-sans font-semibold text-sm mb-1">Areas covered</h2>
          <p className="text-[13px] text-muted">{area}</p>
        </div>
      )}

      {profile && (
        <RatingsList ratings={profile.ratings} firstName={engineer.firstName?.trim() || brand} />
      )}

      <div className="bg-paper border border-line rounded-xl p-3.5">
        <h2 className="font-sans font-semibold text-sm mb-1.5">How it works</h2>
        <ol className="text-[13px] text-muted space-y-1 list-decimal list-inside">
          <li>Join in 2 minutes</li>
          <li>Pay monthly by Direct Debit</li>
          <li>Your engineer books your service in with you</li>
        </ol>
      </div>

      <div className="bg-paper border border-line rounded-xl p-3.5">
        <h2 className="font-sans font-semibold text-sm mb-1.5">FAQs</h2>
        <dl className="space-y-2.5">
          {FAQS.map((f) => (
            <div key={f.q}>
              <dt className="text-[13px] font-semibold">{f.q}</dt>
              <dd className="text-[12.5px] text-muted mt-0.5">{f.a}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="font-mono text-[10px] text-faint text-center pt-1">
        Direct Debit Guarantee protected · 14-day cooling-off · cancel anytime
      </p>

      {profile && (
        <RecruitBanner
          href={`/join/${engineer.slug}?src=profile`}
          text="Are you a gas engineer? Get your free profile"
        />
      )}
    </CustomerShell>
  );
}

// Review 4 — said on every screen of the page while it isn't a real sign-up.
function ModeBanner({ mode }: { mode: ReturnType<typeof pageMode> }) {
  if (mode === "preview") {
    return (
      <div className="rounded-xl border border-warn bg-warn-tint px-3.5 py-2.5 text-[13px] text-ink">
        <b className="text-warn tracking-wide">PREVIEW</b> · This is how your page looks to customers.
        Join is switched off in preview.
      </div>
    );
  }
  if (mode === "practice") {
    return (
      <div className="rounded-xl border border-warn bg-warn-tint px-3.5 py-2.5 text-[13px] text-ink">
        <b className="text-warn tracking-wide">DEMO</b> · Practice only. Nothing here creates a customer
        or takes a payment.
      </div>
    );
  }
  return null;
}
