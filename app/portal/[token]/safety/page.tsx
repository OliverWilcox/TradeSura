import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { Card } from "@/components/ui";
import { ReportForm } from "@/components/report-form";

export default async function SafetyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true },
  });
  if (!plan) notFound();

  const brand = brandName(plan.engineer);
  return (
    <CustomerShell tradingName={brand} legalLine={tradingNameOf(plan.engineer)} sub={`Safety concern · Plan ${plan.ref}`}>
      <Card>
        <p className="text-sm">
          If you think work {brand} did, or something they left, isn&apos;t safe, tell TradeSura here. It comes to our team, not to {brand}, and
          we&apos;ll check their Gas Safe registration again.
        </p>
        <p className="text-sm font-semibold mt-2">If you can smell gas, call the gas emergency line on 0800 111 999 now.</p>
      </Card>
      <ReportForm token={token} kind="safety" />
    </CustomerShell>
  );
}
