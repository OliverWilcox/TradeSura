import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { track } from "@/lib/track";
import { appUrl } from "@/lib/app-url";
import { townSlugOf } from "@/lib/town";
import { claimForPage, claimLookupLimited, platformOf, requestIp, storeUrl } from "@/lib/claim";
import { foundingCountLine, foundingDeadline, spotsLeft } from "@/lib/founding";
import { ClaimFlow } from "@/components/claim-flow";
import { RingMark } from "@/components/ring-mark";
import { btnClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your TradeSura account is waiting",
  description: "Claim your free TradeSura account and your Founding Member spot.",
  robots: { index: false, follow: false },
};

// 30 Oct update §1 — where the QR on the launch letter lands. Built for poor
// signal: one server-rendered page, no images beyond the inline ring, and
// a small client script for the ticks, the form and the store jump. Shows
// back only what's printed on the letter (business name and town) until
// our solicitor says otherwise; nothing else from our list.
export default async function ClaimCodePage({ params }: { params: Promise<{ code: string }> }) {
  const raw = decodeURIComponent((await params).code);
  const h = await headers();
  const platform = platformOf(h.get("user-agent"));
  if (await claimLookupLimited(requestIp(h))) {
    return (
      <Shell>
        <h1 className="font-sans font-bold text-xl">Too many tries</h1>
        <p className="text-sm text-muted">Wait a few minutes, then scan the code on your letter again.</p>
      </Shell>
    );
  }
  const row = await claimForPage(raw);

  if (!row) {
    await track("claim_step", { type: "SYSTEM" }, { code: raw.slice(0, 20), step: "scan", valid: false });
    return (
      <Shell>
        <h1 className="font-sans font-bold text-xl">We couldn&apos;t find that code</h1>
        <p className="text-sm text-muted">
          Check the code on your letter. You can still create your free account in the TradeSura app.
        </p>
        {platform !== "desktop" && (
          <a href={storeUrl(platform, "")} className={btnClass()}>
            Get the TradeSura app
          </a>
        )}
      </Shell>
    );
  }

  // Every scan counts, so this one isn't de-duplicated.
  await track("claim_step", { type: "SYSTEM" }, { code: row.code, step: "scan", platform, variantCell: row.variantCell });

  const letterTown = row.town?.trim() || null;
  const town = row.tradingTown?.trim() || letterTown;
  const townSlug = row.tradingTownSlug || (letterTown ? townSlugOf(letterTown) : null);
  const deadline = await foundingDeadline(row);
  const now = new Date();
  const foundingLine = town
    ? foundingCountLine({ town, spotsLeft: await spotsLeft(townSlug), deadline, now })
    : null;
  const pageUrl = `${appUrl()}/c/${encodeURIComponent(row.code)}`;
  const qr = platform === "desktop" ? await QRCode.toDataURL(pageUrl, { margin: 1, width: 220 }) : null;

  return (
    <Shell>
      <ClaimFlow
        code={row.code}
        businessName={row.suppressedAt ? null : row.businessName}
        town={town}
        foundingLine={foundingLine}
        reservationOpen={now <= deadline}
        alreadyClaimed={Boolean(row.claimedAt)}
        hasAccount={Boolean(row.redeemedByEngineerId)}
        platform={platform}
        storeUrl={platform === "desktop" ? null : storeUrl(platform, row.code)}
        qrDataUrl={qr}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel">
      <header className="px-5 pt-5 pb-3 flex items-center gap-2">
        <RingMark size={22} />
        <span className="font-sans text-lg font-bold tracking-tight">TradeSura</span>
      </header>
      <main className="flex-1 flex flex-col gap-4 px-5 pb-8 pt-2">{children}</main>
      <footer className="font-mono text-[10px] text-faint text-center px-4 py-3">
        TradeSura is run by 302 MD Ltd · <Link href="/privacy" className="underline">Privacy</Link>
      </footer>
    </div>
  );
}
