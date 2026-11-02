import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { track } from "@/lib/track";
import { CustomerShell } from "@/components/shells";
import { SignupConfirmed } from "@/components/signup-confirmed";
import { getStripe } from "@/lib/stripe";
import { profileUrl } from "@/lib/public-url";

// The first collection: the subscription's trial end when Stripe has it (a
// free month pushes it past cooling-off), otherwise the cooling-off end.
async function firstPaymentAt(subscriptionId: string | null, coolingOffEndsAt: Date | null): Promise<Date | null> {
  if (subscriptionId) {
    try {
      const sub = await getStripe().subscriptions.retrieve(subscriptionId);
      if (sub.trial_end) return new Date(sub.trial_end * 1000);
    } catch (err) {
      console.error("[confirmed] subscription lookup failed:", err);
    }
  }
  return coolingOffEndsAt;
}

export default async function ConfirmedPage({
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
      tier: { include: { clauses: { include: { clause: { select: { code: true } } } } } },
      passport: { select: { viewToken: true } },
    },
  });
  // The business's address may have moved since the link was sent (Review 4:
  // old addresses keep working), so an old one still opens the same plan.
  if (!plan || (plan.engineer.slug !== slug && !plan.engineer.previousSlugs.includes(slug))) notFound();

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
    <CustomerShell tradingName={brand} legalLine={tradingNameOf(plan.engineer)} sub={`Plan ${plan.ref} · ${plan.customer.firstName} ${plan.customer.lastName}`}>
      <SignupConfirmed
        token={token}
        tierName={plan.tier?.name ?? "your"}
        priceMonthlyPence={plan.priceMonthlyPence ?? 0}
        vatRegistered={plan.engineer.vatRegistered}
        billingInterval={plan.billingInterval}
        initialStatus={plan.status}
        portalToken={plan.status === "ACTIVE" ? plan.portalToken : null}
        extras={{
          engineer: { brand, firstName: plan.engineer.firstName, photoUrl: plan.engineer.logoUrl },
          coolingOffEndsAt: plan.coolingOffEndsAt?.toISOString() ?? null,
          firstPaymentAt: (await firstPaymentAt(plan.stripeSubscriptionId, plan.coolingOffEndsAt))?.toISOString() ?? null,
          yearly: plan.billingInterval === "year",
          annualService: Boolean(plan.tier?.clauses.some((c) => c.clause.code === "ANNUAL_SERVICE")),
          // §7.9 — a neighbour's link: the engineer's page with this plan's ref.
          referUrl: `${profileUrl(plan.engineer.slug)}?nref=${encodeURIComponent(plan.ref)}`,
          passportUrl: plan.status === "ACTIVE" && plan.passport ? `/passport/${plan.passport.viewToken}` : null,
        }}
      />
    </CustomerShell>
  );
}
