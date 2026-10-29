// Review 4 — the Verified Member badge on the customer's plan pages, as a
// blue status chip (green is money only). Only ever rendered for an
// engineer whose Gas Safe check is done (gasSafeVerifiedAt).
export function VerifiedMemberBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-flame/40 bg-flame-tint px-2 py-0.5 text-[11px] font-semibold text-flame">
      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="11" fill="currentColor" />
        <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Verified Member · Gas Safe verified
    </span>
  );
}

// The header's trust line: the badge once verified, then "Powered by
// TradeSura" ("Backed by" read like a guarantee — Review 4).
export function TrustLine({ verified }: { verified: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {verified && <VerifiedMemberBadge />}
      <span>Powered by TradeSura</span>
    </span>
  );
}
