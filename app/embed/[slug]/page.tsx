import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { appUrl } from "@/lib/app-url";
import { clauseLine } from "@/lib/clauses";
import { profileUrl } from "@/lib/public-url";
import { JOIN_BTN, PlanTierCard } from "@/components/plan-tier-card";
import { EmbedResizer } from "@/components/embed-resizer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

// What /embed.js puts in an iframe on the engineer's own website: their live
// plans, each with a Join that opens the full plan page (checkout never runs
// inside someone else's site). Loading it from a real outside site is what
// ticks off the app's "Connect your website" step.
export default async function EmbedPlans({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ host?: string }>;
}) {
  const { slug } = await params;
  const { host } = await searchParams;
  const engineer = await prisma.engineer.findUnique({ where: { slug } });
  if (!engineer?.tradingName) notFound();
  const tiers = await prisma.planTier.findMany({
    where: { engineerId: engineer.id, status: "LIVE" },
    orderBy: { sortOrder: "asc" },
    include: { clauses: { include: { clause: true } } },
  });

  const ours = new URL(appUrl()).hostname;
  const outside =
    host && /^[a-z0-9.-]{3,253}$/i.test(host) && host !== ours && host !== "localhost" && !host.endsWith(".vercel.app");
  if (outside && !engineer.websiteConnectedAt) {
    await prisma.engineer.update({
      where: { id: engineer.id },
      data: { websiteConnectedAt: new Date(), websiteHost: host.toLowerCase() },
    });
    await track("website_connected", { type: "ENGINEER", id: engineer.id }, { host });
  }

  const base = profileUrl(engineer.slug);
  return (
    <div className="bg-panel p-3 text-ink">
      <EmbedResizer slug={slug} />
      {tiers.length === 0 ? (
        <p className="text-sm text-muted text-center py-4">
          {engineer.tradingName}&apos;s care plans are coming soon.
        </p>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {tiers.map((t) => {
            const lines = [
              ...t.clauses
                .sort((a, b) => a.clause.sortOrder - b.clause.sortOrder)
                .map((tc) => clauseLine(tc.clause)),
              ...t.customLabels,
            ];
            return (
              <div key={t.id} className="flex flex-col gap-2.5">
                <PlanTierCard name={t.name} priceMonthlyPence={t.priceMonthlyPence} lines={lines} />
                <a href={`${base}?src=website&tier=${t.id}`} target="_blank" rel="noopener" className={JOIN_BTN}>
                  Join
                </a>
              </div>
            );
          })}
        </div>
      )}
      <p className="font-mono text-[10px] text-faint text-center pt-2.5">
        Monthly by Direct Debit · cancel anytime · powered by TradeSura
      </p>
    </div>
  );
}
