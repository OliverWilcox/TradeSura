import { notFound } from "next/navigation";
import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shells";
import { Micro } from "@/components/ui";
import { TierEditor } from "@/components/tier-editor";

export default async function TierPage({ params }: { params: Promise<{ tierId: string }> }) {
  const engineer = await requireEngineer();
  const { tierId } = await params;
  const tier = await prisma.planTier.findFirst({
    where: { id: tierId, engineerId: engineer.id },
    include: { clauses: true },
  });
  if (!tier) notFound();
  // CARE clauses stay out of the picker until solicitor sign-off (handover §3).
  const templates = await prisma.clauseTemplate.findMany({
    where: { status: "SAFE" },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <AppShell active="PLANS" topRight={<Micro>Plan builder</Micro>}>
      <TierEditor
        tier={{
          id: tier.id,
          name: tier.name,
          priceMonthlyPence: tier.priceMonthlyPence,
          isRecommended: tier.isRecommended,
          customLabels: tier.customLabels,
          clauseIds: tier.clauses.map((c) => c.clauseId),
        }}
        templates={templates.map((t) => ({
          id: t.id,
          code: t.code,
          title: t.title,
          kind: t.kind,
          category: t.category,
          upliftPence: t.upliftPence,
          pricingLabel: t.pricingLabel,
          highlight: t.highlight,
        }))}
      />
    </AppShell>
  );
}
