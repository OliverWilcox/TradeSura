import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { verifyGasSafe } from "@/lib/gas-safe";
import { CustomerShell } from "@/components/shells";
import { PublicSignup } from "@/components/public-signup";

export const dynamic = "force-dynamic";

async function loadEngineer(slug: string) {
  const engineer = await prisma.engineer.findUnique({ where: { slug } });
  if (!engineer || !engineer.tradingName) return null;
  const tiers = await prisma.planTier.findMany({
    where: { engineerId: engineer.id, status: "LIVE" },
    orderBy: { sortOrder: "asc" },
    include: { clauses: { include: { clause: true } } },
  });
  return { engineer, tiers };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadEngineer(slug);
  if (!data) return { title: "Care plan" };
  return {
    title: `${data.engineer.tradingName} Care Plans`,
    description: `Monthly boiler care plans from ${data.engineer.tradingName}, a Gas Safe registered engineer.`,
  };
}

const FAQS: { q: string; a: string }[] = [
  {
    q: "What's included?",
    a: "Your annual boiler service and priority booking, plus whatever else your chosen plan lists. Every service and check on your plan is carried out by your own engineer.",
  },
  {
    q: "What's not included?",
    a: "Breakdown repairs. If something breaks you get priority and your plan discount on the work — this is a maintenance and priority agreement, not an insurance policy.",
  },
  {
    q: "When is my service?",
    a: "We set your service month when you join and message you to book it in — you don't have to remember.",
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

export default async function PublicPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; demo?: string; by?: string }>;
}) {
  const { slug } = await params;
  const { src, demo, by } = await searchParams;
  const data = await loadEngineer(slug);
  if (!data) notFound();
  const { engineer, tiers } = data;

  // The engineer's Stripe Connect business_profile.url points here from the
  // moment they connect payments (onboarding step 1) — before they've
  // published a plan (step 2). A hard 404 in that gap makes Stripe flag the
  // account for an unreachable/"under construction" business website, so
  // this renders a real, honest holding page instead of notFound().
  if (tiers.length === 0) {
    return (
      <CustomerShell tradingName={engineer.tradingName!}>
        <div className="bg-paper border border-line rounded-xl p-4 text-center">
          <h1 className="font-sans font-semibold text-base mb-1.5">
            {engineer.tradingName}&apos;s care plans
          </h1>
          <p className="text-sm text-muted">
            Monthly boiler care plans from a Gas Safe registered engineer — annual service,
            priority booking, no call-out fees. Plans are being set up now; check back soon, or
            ask {engineer.tradingName} directly.
          </p>
        </div>
      </CustomerShell>
    );
  }

  // Live Gas Safe check — the badge shows register data queried now, not a
  // value cached at signup.
  const gasSafe = engineer.gasSafeNo ? await verifyGasSafe(engineer.gasSafeNo) : null;
  const brand = engineer.tradingName!;

  await track("page_visit", { type: "CUSTOMER" }, {
    engineerId: engineer.id,
    slug,
    source: demo ? "demo" : (src ?? "direct"),
  });

  return (
    <CustomerShell
      tradingName={brand}
      // Build Guide v2 Part 15.1 — the trust line, verbatim. Never asserted
      // for an engineer who isn't actually verified — a false compliance
      // claim to a customer matters more than matching the string exactly.
      sub={gasSafe ? "Gas Safe verified · Backed by TradeSura" : "Backed by TradeSura"}
    >
      {/* Build Guide v2 Part 15.1 — title + sub-line, verbatim. */}
      <div>
        <h1 className="font-sans font-semibold text-lg">Choose your plan</h1>
        <p className="text-sm text-muted">Cancel anytime — set up takes about a minute.</p>
      </div>

      <PublicSignup
        slug={slug}
        engineerName={brand}
        channel={demo ? "demo" : src === "blast" ? "blast" : src === "referral" ? "referral" : "web"}
        soldById={demo ? by : undefined}
        tiers={tiers.map((t) => ({
          id: t.id,
          name: t.name,
          priceMonthlyPence: t.priceMonthlyPence,
          isRecommended: t.isRecommended,
          lines: [
            ...t.clauses
              .sort((a, b) => a.clause.sortOrder - b.clause.sortOrder)
              .map((tc) => tc.clause.title),
            ...t.customLabels,
          ],
        }))}
      />

      <div className="bg-paper border border-line rounded-xl p-3.5">
        <h2 className="font-sans font-semibold text-sm mb-1.5">How it works</h2>
        <ol className="text-[13px] text-muted space-y-1 list-decimal list-inside">
          <li>Join in 2 minutes</li>
          <li>Pay monthly by Direct Debit</li>
          <li>Your service is booked automatically each year</li>
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
    </CustomerShell>
  );
}
