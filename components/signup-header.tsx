import type { ReactNode } from "react";
import { VerifiedMemberBadge } from "@/components/verified-badge";
import { RatingLine, type RatingSummary } from "@/components/engineer-profile";

// 30 Oct update §7.1 — the header on every customer sign-up page: the
// engineer's photo, first name and trading name (never the legal name), the
// Verified badge, the Founding badge if they have one, qualifications and
// reviews (hidden until the first review), and the line that says why this
// isn't a call centre.
export type SignupHeaderProps = {
  brand: string;
  firstName: string | null;
  photoUrl: string | null;
  town?: string | null;
  verified: boolean;
  /** §10 — the Founding Member badge, when they have one. */
  founding?: ReactNode;
  /** §4.5 — "Qualified for: Gas boilers · Cookers…", from the card check. */
  qualifications?: string[] | null;
  /** Hidden entirely until the first review. */
  rating?: RatingSummary | null;
  /** The profile's Google heading ("Gas engineer in {town}"). */
  googleHeading?: boolean;
  /** "Our engineers are qualified for…" when a staff card was used. */
  teamQualified?: boolean;
};

export const TRUST_LINE = "The engineer you already know and trust, not a call centre.";

export function SignupHeader(p: SignupHeaderProps) {
  const first = p.firstName?.trim();
  const reviewed = p.rating && p.rating.count > 0;
  const quals = p.qualifications?.filter(Boolean) ?? [];
  return (
    <div className="bg-paper border border-line rounded-xl p-4">
      <div className="flex gap-3 items-start">
        {p.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- engineer's own photo from Blob
          <img src={p.photoUrl} alt={first ? `${first}, ${p.brand}` : p.brand} className="h-16 w-16 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-16 w-16 rounded-full bg-flame-tint text-flame font-bold text-2xl flex items-center justify-center shrink-0">
            {(first || p.brand).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {p.googleHeading ? (
            <h1 className="font-sans font-bold text-lg leading-tight">
              <span className="block text-[12.5px] font-medium text-muted">Gas engineer{p.town ? ` in ${p.town}` : ""}</span>
              <span className="sr-only"> · </span>
              {first ? `${first} · ${p.brand}` : p.brand}
            </h1>
          ) : (
            <p className="font-sans font-bold text-lg leading-tight">{first ? `${first} · ${p.brand}` : p.brand}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {p.verified && <VerifiedMemberBadge />}
            {p.founding}
            {reviewed && <RatingLine rating={p.rating!} />}
          </div>
        </div>
      </div>
      {quals.length > 0 && (
        <p className="mt-3 text-[12.5px] text-muted">
          <span className="font-semibold text-ink">{p.teamQualified ? "Our engineers are qualified for:" : "Qualified for:"}</span>{" "}
          {quals.join(" · ")}
        </p>
      )}
      <p className="mt-3 text-[13px] text-ink">{TRUST_LINE}</p>
    </div>
  );
}
