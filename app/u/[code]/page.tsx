import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { Card } from "@/components/ui";
import { RescueForm } from "@/components/rescue-form";
import { chargePence, paymentOutstanding, poundsLabel, ukPhoneDisplay } from "@/lib/plan-billing";

export const metadata: Metadata = { robots: { index: false } };

// Retention spec §3 — tradesura.com/u/{code}, from the engineer's "your
// payment didn't go through" text: set up a new Direct Debit in one step.
export default async function RescuePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const plan = await prisma.plan.findUnique({
    where: { rescueCode: code.toUpperCase() },
    include: { engineer: true, customer: true, tier: true },
  });
  if (!plan) notFound();

  const brand = brandName(plan.engineer);
  const phone = ukPhoneDisplay(plan.engineer.phone);
  const amount = poundsLabel(chargePence(plan.priceMonthlyPence ?? 0, plan.billingInterval));
  const shell = (children: React.ReactNode) => (
    <CustomerShell
      tradingName={brand}
      legalLine={tradingNameOf(plan.engineer)}
      sub={`Plan ${plan.ref} · ${plan.customer.firstName} ${plan.customer.lastName}`}
    >
      {children}
    </CustomerShell>
  );

  if (plan.status === "CANCELLED") {
    return shell(
      <Card className="text-center py-6">
        <p className="font-semibold">This plan has ended</p>
        <p className="text-xs text-muted mt-1">
          {phone ? `To rejoin, call ${brand} on ${phone}.` : `To rejoin, get in touch with ${brand}.`}
        </p>
      </Card>,
    );
  }

  if (!paymentOutstanding(plan)) {
    return shell(
      <Card className="text-center py-6">
        <div className="text-2xl">✓</div>
        <p className="font-semibold mt-1">You&apos;re all set</p>
        <p className="text-xs text-muted mt-1">Your plan with {brand} carries on as normal. Nothing to do.</p>
        <a href={`/portal/${plan.portalToken}`} className="underline text-sm mt-3 inline-block">
          View my plan
        </a>
      </Card>,
    );
  }

  return shell(
    <RescueForm
      code={plan.rescueCode!}
      firstName={plan.customer.firstName}
      brand={brand}
      amountLabel={amount}
      planName={plan.tier?.name ?? null}
      engineerPhone={phone}
      portalToken={plan.portalToken}
    />,
  );
}
