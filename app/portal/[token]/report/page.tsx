import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CustomerShell } from "@/components/shells";
import { ReportForm } from "@/components/report-form";

export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true },
  });
  if (!plan) notFound();

  const brand = plan.engineer.tradingName ?? plan.engineer.slug;
  return (
    <CustomerShell tradingName={brand} sub={`Report a problem · Plan ${plan.ref}`}>
      <ReportForm token={token} />
    </CustomerShell>
  );
}
