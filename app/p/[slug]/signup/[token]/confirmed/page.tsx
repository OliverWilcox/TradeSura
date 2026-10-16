import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
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

  // Build Review 2, section 10 — the customer finished the Direct Debit form
  // (the plan only goes ACTIVE later, on invoice.paid). Once per plan, so a
  // refresh doesn't double-count.
  const seen = await prisma.event.count({
    where: { name: "checkout_completed", meta: { path: ["planId"], equals: plan.id } },
  });
  if (seen === 0) {
    await track("checkout_completed", { type: "CUSTOMER", id: plan.customerId }, {
      planId: plan.id,
      engineerId: plan.engineerId,
    });
  }

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
