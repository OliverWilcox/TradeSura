import Link from "next/link";
import type { PublicRating } from "@/lib/ratings";

// Section 6 — the pieces the Google-facing profile adds on top of the plan
// page (components/engineer-page.tsx), and that the town page reuses.

export type RatingSummary = { average: number | null; count: number; isNew: boolean };

export function Stars({ value, className = "" }: { value: number; className?: string }) {
  const full = Math.round(value);
  return (
    <span className={`text-warn tracking-[0.05em] ${className}`} aria-label={`${value} out of 5 stars`}>
      {"★".repeat(full)}
      <span className="text-faint">{"★".repeat(5 - full)}</span>
    </span>
  );
}

// "★★★★★ 4.9 from 38 verified TradeSura customers", or "New to TradeSura"
// until the admin-set number of ratings is reached.
export function RatingLine({ rating, short = false }: { rating: RatingSummary; short?: boolean }) {
  if (rating.isNew || rating.average === null) {
    return <span className="text-[12.5px] text-muted">New to TradeSura</span>;
  }
  return (
    <span className="text-[12.5px] text-muted">
      <Stars value={rating.average} />{" "}
      <b className="text-ink">{rating.average.toFixed(1)}</b>{" "}
      {short
        ? `(${rating.count})`
        : `from ${rating.count} verified TradeSura customer${rating.count === 1 ? "" : "s"}`}
    </span>
  );
}

export function PartnerBadge() {
  return (
    <span className="inline-block font-mono text-[10px] font-semibold px-2 py-0.5 rounded-md bg-flame-tint text-flame tracking-[0.06em]">
      WEBSITE PARTNER
    </span>
  );
}

export function ProfileHeader({
  brand,
  logoUrl,
  town,
  verified,
  partner,
  rating,
}: {
  brand: string;
  logoUrl: string | null;
  town: string | null;
  verified: boolean;
  partner: boolean;
  rating: RatingSummary;
}) {
  return (
    <div className="bg-paper border border-line rounded-xl p-4 flex gap-3 items-start">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- engineer's uploaded logo from Blob
        <img src={logoUrl} alt="" className="h-14 w-14 rounded-full object-cover shrink-0" />
      ) : (
        <div className="h-14 w-14 rounded-full bg-flame-tint text-flame font-bold text-xl flex items-center justify-center shrink-0">
          {brand.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="font-sans font-bold text-lg leading-tight">{brand}</h1>
        <p className="text-[12.5px] text-muted mt-0.5">
          Gas Engineer{town ? ` in ${town}` : ""}
          {verified && <span className="font-semibold text-ink"> · GAS SAFE VERIFIED</span>}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {partner && <PartnerBadge />}
          <RatingLine rating={rating} />
        </div>
      </div>
    </div>
  );
}

export function ProfilePhotos({ photos, brand }: { photos: string[]; brand: string }) {
  if (photos.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {photos.slice(0, 4).map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- engineer's own photos from Blob
        <img
          key={src}
          src={src}
          alt={`${brand} photo ${i + 1}`}
          loading="lazy"
          className="aspect-[4/3] w-full rounded-xl object-cover border border-line"
        />
      ))}
    </div>
  );
}

const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });

// All ratings, never filtered (UK fake-review rules), with the installer's reply.
export function RatingsList({ ratings, firstName }: { ratings: PublicRating[]; firstName: string }) {
  if (ratings.length === 0) return null;
  return (
    <div className="bg-paper border border-line rounded-xl p-3.5">
      <h2 className="font-sans font-semibold text-sm mb-1">Ratings</h2>
      <ul className="divide-y divide-line-soft">
        {ratings.map((r) => (
          <li key={r.id} className="py-2.5">
            <p className="text-[11.5px] text-muted">
              <Stars value={r.stars} /> Verified TradeSura customer · {monthYear(r.ratedAt)}
            </p>
            {r.comment && <p className="text-[13px] mt-1">&ldquo;{r.comment}&rdquo;</p>}
            {r.customerName && <p className="text-[11.5px] text-faint mt-0.5">{r.customerName}</p>}
            {r.reply && (
              <p className="text-[12.5px] text-muted mt-1.5 pl-3 border-l-2 border-line-strong">
                <span className="font-semibold text-ink">Reply from {firstName}:</span> {r.reply}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Recruitment — on every profile and town page. From a profile the link
// carries that installer's referral code, so the sign-up is credited to them.
export function RecruitBanner({ href, text }: { href: string; text: string }) {
  return (
    <Link
      href={href}
      className="block bg-flame-tint border border-line rounded-xl px-3.5 py-3 text-[13px] font-semibold text-flame text-center"
    >
      {text} →
    </Link>
  );
}
