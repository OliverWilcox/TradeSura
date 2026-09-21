import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { SignupConfirmed } from "@/components/signup-confirmed";

export default async function ConfirmedPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { signupToken: token },
    include: { engineer: true, customer: true, tier: true },
  });
  if (!plan || plan.engineer.slug !== slug) notFound();

  const brand = brandName(plan.engineer);
  return (
    <CustomerShell tradingName={brand} sub={`Plan ${plan.ref} · ${plan.customer.firstName} ${plan.customer.lastName}`}>
      <SignupConfirmed
        token={token}
        tierName={plan.tier?.name ?? "your"}
        priceMonthlyPence={plan.priceMonthlyPence ?? 0}
        initialStatus={plan.status}
        portalToken={plan.status === "ACTIVE" ? plan.portalToken : null}
      />
    </CustomerShell>
  );
}
