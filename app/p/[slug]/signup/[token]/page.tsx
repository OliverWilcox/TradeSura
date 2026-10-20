import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { CustomerShell } from "@/components/shells";
import { SignupTiers } from "@/components/signup-tiers";
import { clauseLine } from "@/lib/clauses";

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
      customer: true,
    },
  });
  if (!plan || plan.engineer.slug !== slug) notFound();
  if (plan.status === "ACTIVE") redirect(`/p/${slug}/signup/${token}/confirmed`);

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
  // Build Guide v2 Part 9.2/15.1 — a personal offer link (route 2) pins the
  // offered plan first with "{Engineer first name} suggested {plan name}".
  // plan.tierId is set the moment the engineer picks a plan to offer
  // (/api/offer); it's only a suggestion until /choose freezes it for real.
  const pinnedTier = plan.tierId ? tiers.find((t) => t.id === plan.tierId) : null;
  return (
    <CustomerShell
      tradingName={brand}
      sub={plan.engineer.gasSafeVerifiedAt ? "Gas Safe verified · Backed by TradeSura" : "Backed by TradeSura"}
    >
      <p className="text-sm">
        Hi {plan.customer.firstName} — pick the plan that suits you. The monthly price you see is
        the full price: no joining fee, nothing added later.
      </p>
      <SignupTiers
        token={token}
        engineerName={brand}
        pinnedTierId={pinnedTier?.id}
        pinnedGreeting={
          pinnedTier ? `${plan.engineer.firstName ?? brand} suggested ${pinnedTier.name}` : null
        }
        tiers={tiers.map((t) => ({
          id: t.id,
          name: t.name,
          priceMonthlyPence: t.priceMonthlyPence,
          isRecommended: t.isRecommended,
          lines: [
            ...t.clauses
              .sort((a, b) => a.clause.sortOrder - b.clause.sortOrder)
              .map((tc) => clauseLine(tc.clause)),
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
