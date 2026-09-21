import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { CancelFlow } from "@/components/cancel-flow";
import { poundsFromPence } from "@/lib/plan-doc";

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true, tier: true },
  });
  if (!plan) notFound();

  const brand = brandName(plan.engineer);
  return (
    <CustomerShell tradingName={brand} sub={`Manage plan · ${plan.ref}`}>
      <CancelFlow
        token={token}
        status={plan.status}
        tierName={plan.tier?.name ?? "your"}
        priceLabel={poundsFromPence(plan.priceMonthlyPence ?? 0)}
        coolingOffEndsAt={plan.coolingOffEndsAt?.toISOString() ?? null}
      />
    </CustomerShell>
  );
}
