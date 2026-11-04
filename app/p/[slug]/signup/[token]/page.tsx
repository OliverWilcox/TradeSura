import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { track } from "@/lib/track";
import { CustomerShell } from "@/components/shells";
import { SignupTiers } from "@/components/signup-tiers";
import { clauseLine, isLandlordPlan } from "@/lib/clauses";
import { SignupHeader } from "@/components/signup-header";
import { FoundingBadge } from "@/components/founding-badge";
import { serviceOrderForVisit } from "@/lib/yearly-service";
import { TrustLine } from "@/components/verified-badge";
import { isFoundingMember } from "@/lib/founding";
import { signupPath } from "@/lib/public-url";
import { ratingSummary } from "@/lib/ratings";

export default async function SignupPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { signupToken: token },
    include: {
      engineer: true,
      customer: { include: { properties: { take: 1 } } },
    },
  });
  // The business's address may have moved since the link was sent (Review 4:
  // old addresses keep working), so an old one still opens the same plan.
  if (!plan || (plan.engineer.slug !== slug && !plan.engineer.previousSlugs.includes(slug))) notFound();
  if (plan.status === "ACTIVE") redirect(`${signupPath(plan.engineer.slug, token)}/confirmed`);

  if (!plan.linkOpenedAt) {
    await prisma.plan.update({
      where: { id: plan.id },
      data: { linkOpenedAt: new Date() },
    });
    await track("signup_opened", { type: "CUSTOMER", id: plan.customerId }, {
      planId: plan.id,
      ref: plan.ref,
    });
  }

  const tiers = await prisma.planTier.findMany({
    where: { engineerId: plan.engineerId, status: "LIVE" },
    orderBy: { sortOrder: "asc" },
    include: { clauses: { include: { clause: true } } },
  });

  const brand = brandName(plan.engineer);
  const home = plan.customer.properties[0] ?? null;
  // Build Guide v2 Part 9.2/15.1 — a personal offer link (route 2) pins the
  // offered plan first with "{Engineer first name} suggested {plan name}".
  // plan.tierId is set the moment the engineer picks a plan to offer
  // (/api/offer); it's only a suggestion until /choose freezes it for real.
  const pinnedTier = plan.tierId ? tiers.find((t) => t.id === plan.tierId) : null;
  return (
    <CustomerShell
      tradingName={brand}
      legalLine={tradingNameOf(plan.engineer)}
      // The badges sit once, in the §7.1 header below.
      sub={<TrustLine verified={false} />}
    >
      <SignupHeader
        brand={brand}
        firstName={plan.engineer.firstName}
        photoUrl={plan.engineer.logoUrl}
        verified={Boolean(plan.engineer.gasSafeVerifiedAt)}
        founding={(await isFoundingMember(plan.engineer.id)) ? <FoundingBadge /> : null}
        rating={await ratingSummary(plan.engineer.id)}
      />
      <p className="text-sm">
        Hi {plan.customer.firstName} — pick the plan that suits you. The monthly price you see is
        the full price: no joining fee, nothing added later.
      </p>
      <SignupTiers
        token={token}
        engineerName={brand}
        initialAddress={home && { line1: [home.addressLine1, home.addressLine2].filter(Boolean).join(", "), town: home.town ?? "", postcode: home.postcode }}
        vatRegistered={plan.engineer.vatRegistered}
        pinnedTierId={pinnedTier?.id}
        normalPrices={{
          normalServicePence: plan.engineer.normalServicePence,
          normalCalloutPence: plan.engineer.normalCalloutPence,
        }}
        serviceOrder={serviceOrderForVisit(plan.visitReason)}
        pinnedGreeting={
          pinnedTier ? `${plan.engineer.firstName ?? brand} suggested ${pinnedTier.name}` : null
        }
        tiers={tiers.map((t) => ({
          id: t.id,
          name: t.name,
          priceMonthlyPence: t.priceMonthlyPence,
          isRecommended: t.isRecommended,
          codes: t.clauses.map((tc) => tc.clause.code),
          landlord: isLandlordPlan(t.clauses.map((tc) => tc.clause.code)),
          lines: [
            ...t.clauses
              .sort((a, b) => a.clause.sortOrder - b.clause.sortOrder)
              .map((tc) => clauseLine(tc.clause, t.clauseRates)),
            ...t.customLabels,
          ],
        }))}
      />
      <p className="font-mono text-[10px] text-faint text-center pt-1">
        Direct Debit Guarantee protected · 14-day cooling-off · cancel anytime
      </p>
    </CustomerShell>
  );
}
