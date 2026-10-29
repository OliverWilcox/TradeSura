import Image from "next/image";

// Review 4 — the Verified Member badge on the customer's plan pages: the
// supplied badge artwork (public/brand, from mobile/assets/brand — never
// redrawn) beside a blue status chip (green is money only). Only ever
// rendered for an engineer whose Gas Safe check is done (gasSafeVerifiedAt).
export function VerifiedMemberBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-flame/40 bg-flame-tint py-0.5 pl-0.5 pr-2 text-[11px] font-semibold text-flame">
      <Image
        src="/brand/verified-member-badge.png"
        alt="TradeSura Verified Member badge"
        width={20}
        height={20}
        unoptimized
      />
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
