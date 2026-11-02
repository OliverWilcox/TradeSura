import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { appUrl } from "@/lib/app-url";
import { clauseLine } from "@/lib/clauses";
import { canonicalProfileUrl, planLinkUrl } from "@/lib/public-url";
import { planSlugs } from "@/lib/plan-slugs";
import { pageMode } from "@/lib/public-page";
import { ratingSummary } from "@/lib/ratings";
import { Stars } from "@/components/engineer-profile";
import { tradingNameOf } from "@/lib/engineer";
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
  // A website keeps the code it was given, so an address the business used
  // to have still finds them (Review 4: old addresses keep working).
  const engineer =
    (await prisma.engineer.findUnique({ where: { slug } })) ??
    (await prisma.engineer.findFirst({ where: { previousSlugs: { has: slug } } }));
  if (!engineer?.tradingName) notFound();
  // Section 7 — admin can switch a widget off, and an installer who has
  // left shows nothing: the widget renders empty and the iframe shrinks to 0.
  if (engineer.widgetDisabledAt || engineer.leftAt || engineer.deletedAt) {
    return <EmbedResizer slug={slug} />;
  }
  const tiers = await prisma.planTier.findMany({
    where: { engineerId: engineer.id, status: "LIVE" },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
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

  // Join opens that plan's own link (Review 4), tagged "website". Review 4
  // also — the widget respects the offer lock: until the Gas Safe check and
  // payments are done the plans show, but there's no Join.
  const slugs = planSlugs(tiers);
  const locked = pageMode({ preview: false, practice: false, engineer }) === "closed";
  const rating = await ratingSummary(engineer.id);
  const verified = Boolean(engineer.gasSafeVerifiedAt);
  return (
    <div className="bg-panel p-3 text-ink">
      <EmbedResizer slug={slug} />
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5">
        <p className="font-semibold text-[15px]">{locked ? "Our care plans" : "Join one of our care plans"}</p>
        <div className="flex items-center gap-2 text-[12px] text-muted">
          {!rating.isNew && rating.average !== null && (
            <span>
              <Stars value={rating.average} /> <b className="text-ink">{rating.average.toFixed(1)}</b> ({rating.count})
            </span>
          )}
          {verified && (
            <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-md bg-warn-tint text-warn">
              VERIFIED MEMBER
            </span>
          )}
        </div>
      </div>
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
                .map((tc) => clauseLine(tc.clause, t.clauseRates)),
              ...t.customLabels,
            ];
            return (
              <div key={t.id} className="flex flex-col gap-2.5">
                <PlanTierCard
                  name={t.name}
                  priceMonthlyPence={t.priceMonthlyPence}
                  vatRegistered={engineer.vatRegistered}
                  lines={lines}
                />
                {!locked && (
                  <a
                    href={`${planLinkUrl(engineer.slug, slugs.get(t.id))}?src=website`}
                    target="_blank"
                    rel="noopener"
                    className={JOIN_BTN}
                  >
                    Join
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
      {locked && tiers.length > 0 && (
        <p className="text-[13px] text-muted text-center pt-3">
          {`${engineer.tradingName} isn't taking sign-ups online just yet. Check back soon, or ask them directly.`}
        </p>
      )}
      {/* Section 7 — a visible, branded link back; never keyword-stuffed. */}
      <p className="text-center pt-3">
        <a
          href={canonicalProfileUrl(engineer)}
          target="_blank"
          rel="noopener"
          className="text-[13px] font-semibold text-flame underline"
        >
          View {engineer.tradingName} on TradeSura
        </a>
      </p>
      <p className="font-mono text-[10px] text-faint text-center pt-2">
        Monthly by Direct Debit · cancel anytime · powered by TradeSura
      </p>
      {tradingNameOf(engineer) && (
        <p className="font-mono text-[10px] text-faint text-center pt-1">{tradingNameOf(engineer)}</p>
      )}
    </div>
  );
}
