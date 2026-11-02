import type { Metadata } from "next";
import { headers } from "next/headers";
import { appTokenAllows, claimForPage, claimLookupLimited, platformOf, requestIp, storeUrl } from "@/lib/claim";
import { track } from "@/lib/track";
import { OpenAppButton } from "@/components/claim-flow";
import { RingMark } from "@/components/ring-mark";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Open TradeSura",
  robots: { index: false, follow: false },
};

// 30 Oct update §1.4 / §3.2 — the personal link in the claim text: "Tap here
// once the app's installed". Opens the app on the welcome screen with the
// code, which loads what they confirmed on the claim page.
export default async function ClaimAppLink({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const h = await headers();
  const platform = platformOf(h.get("user-agent"));
  const limited = await claimLookupLimited(requestIp(h));
  const row = limited ? null : await claimForPage(decodeURIComponent((await params).code));
  const code = row?.code ?? "";
  // The token rides into the app, which uses it to load the confirmed
  // details (resolveClaimCode); a stale or wrong one just loads nothing.
  const t = (await searchParams).t;
  const token = row && t && (await appTokenAllows(t, row.code)) ? t : null;
  if (row) await track("claim_step", { type: "SYSTEM" }, { code: row.code, step: "app_link_opened", platform, token: Boolean(token) });
  const deepLink = code
    ? `tradesura://welcome?code=${encodeURIComponent(code)}${token ? `&t=${encodeURIComponent(token)}` : ""}`
    : "tradesura://welcome";

  return (
    <div className="flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel">
      <header className="px-5 pt-5 pb-3 flex items-center gap-2">
        <RingMark size={22} />
        <span className="font-sans text-lg font-bold tracking-tight">TradeSura</span>
      </header>
      <main className="flex-1 flex flex-col gap-4 px-5 pb-8 pt-2">
        <h1 className="font-sans font-bold text-xl">Opening TradeSura…</h1>
        {code && (
          <p className="text-sm text-muted">
            Your claim code is <b className="font-mono text-ink">{code}</b>.
          </p>
        )}
        <OpenAppButton deepLink={deepLink} />
        {platform !== "desktop" && (
          <p className="text-sm text-muted">
            Not installed yet?{" "}
            <a href={storeUrl(platform, code)} className="text-flame underline">
              Get the app
            </a>
            , then tap the link in your text again.
          </p>
        )}
      </main>
    </div>
  );
}
