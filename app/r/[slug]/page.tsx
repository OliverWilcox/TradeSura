import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { btnClass } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "TradeSura — recommended by an engineer you know",
    openGraph: { images: [`/api/referral/card?slug=${slug}`] },
  };
}

// E10 — the referral landing page. A prospective engineer arrives from a
// WhatsApp share; hands off to the native sign-up wizard with ?ref= so the
// referral links on the new account.
export default async function ReferralLanding({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const referrer = await prisma.engineer.findUnique({ where: { slug } });
  if (!referrer || !referrer.tradingName) notFound();

  await track("referral_link_opened", { type: "SYSTEM" }, { referrerId: referrer.id });
  // W0 — lands on the welcome screen first (personalised sub-line), not
  // straight on sign-up; it carries ref (and the real trading name, so the
  // screen doesn't have to guess one from the slug) through when continuing.
  const appHref = `tradesura://welcome?ref=${encodeURIComponent(slug)}&name=${encodeURIComponent(referrer.tradingName)}`;

  return (
    <div className="flex flex-col max-w-md w-full mx-auto min-h-screen bg-panel">
      <header className="bg-flame text-white px-5 py-7 text-center">
        <div className="font-disp text-2xl font-bold uppercase tracking-wide">
          Trade<span className="text-[#7EE2AE]">Sura</span>
        </div>
        <div className="text-[13px] opacity-90 mt-1">Your trade. On plan.</div>
      </header>
      <main className="flex-1 flex flex-col gap-3.5 px-5 py-7 text-center">
        <p className="text-sm text-muted">
          <b>{referrer.gasSafeName ?? referrer.tradingName}</b> uses TradeSura to put customers on
          monthly care plans.
        </p>
        <div className="rounded-[12px] bg-paper border border-line p-4 text-left">
          <p className="font-semibold text-sm mb-1.5">What you get</p>
          <ul className="text-[13px] text-muted space-y-1 list-disc list-inside">
            <li>Free account, founding-member pricing — you keep 80%</li>
            <li>Customers pay by Direct Debit, you&apos;re paid weekly</li>
            <li>Plan wording stays solicitor-approved automatically</li>
          </ul>
        </div>
        <a href={appHref} className={btnClass()}>
          Create my free account
        </a>
        <p className="text-[11px] text-faint">
          Opens the TradeSura app.{" "}
          <a href="https://apps.apple.com/app/tradesura" className="underline">
            App&nbsp;Store
          </a>{" "}
          ·{" "}
          <a href="https://play.google.com/store/apps/details?id=com.tradesura.engineer" className="underline">
            Google&nbsp;Play
          </a>
        </p>
      </main>
      <footer className="font-mono text-[10px] text-faint text-center px-4 py-3">
        Care plans are ongoing service agreements with your engineer, not insurance products.
      </footer>
    </div>
  );
}
