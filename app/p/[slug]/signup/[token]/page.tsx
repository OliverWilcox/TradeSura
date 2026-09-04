import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { CustomerShell, GasSafeBadge } from "@/components/shells";
import { SignupTiers } from "@/components/signup-tiers";

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
    where: { engineerId: plan.engineerId, archived: false },
    orderBy: { sortOrder: "asc" },
    include: { clauses: { include: { clause: true } } },
  });

  const brand = plan.engineer.tradingName ?? plan.engineer.slug;
  return (
    <CustomerShell
      tradingName={brand}
      sub={
        <>
          Your engineer: {plan.engineer.gasSafeName ?? brand}{" "}
          {plan.engineer.gasSafeNo && <GasSafeBadge regNo={plan.engineer.gasSafeNo} />}
        </>
      }
    >
      <p className="text-sm">
        Hi {plan.customer.firstName} — pick the plan that suits you. The monthly price you see is
        the full price: no joining fee, nothing added later.
      </p>
      <SignupTiers
        token={token}
        engineerName={brand}
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
      <p className="font-mono text-[10px] text-faint text-center pt-1">
        Direct Debit Guarantee protected · 14-day cooling-off · cancel anytime
      </p>
    </CustomerShell>
  );
}
