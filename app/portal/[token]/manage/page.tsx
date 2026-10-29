import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { CancelFlow } from "@/components/cancel-flow";
import { cancelContext, longDate } from "@/lib/cancel-plan";
import { annualServiceUnlocked } from "@/lib/plan-billing";
import { nextServiceDate } from "@/lib/reminders";
import { PASSPORT_FREEZE_LINE, WARRANTY_LINE } from "@/lib/retention";

// Retention spec, section 2 — the customer's three cancel screens, filled
// from live data. `?switch=<tierId>` arrives from the engineer's "offer a
// cheaper plan" text.
export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ switch?: string }>;
}) {
  const { token } = await params;
  const { switch: switchTierId } = await searchParams;
  const found = await prisma.plan.findUnique({ where: { portalToken: token }, select: { id: true } });
  if (!found) notFound();

  const { plan, brand, tier, serviceUsed, figures, cheaper } = await cancelContext(found.id);
  const unlocked = annualServiceUnlocked(plan);
  const hasService = tier?.clauses.some((c) => c.code === "ANNUAL_SERVICE") ?? false;
  const serviceDue = !hasService
    ? null
    : serviceUsed && plan.activatedAt
      ? `You've had this year's service. The next one is due by ${longDate(nextServiceDate(plan.activatedAt))}.`
      : unlocked
        ? `Your annual service is ready to book now. Just call or text ${brand}.`
        : plan.billingInterval === "year"
          ? "Your annual service becomes available from the start of your third plan month."
          : "Your annual service becomes available after your third payment.";

  const now = new Date();
  const endingOn =
    plan.status !== "CANCELLED" && plan.cancelRequestedAt && plan.cancelEffectiveAt && plan.cancelEffectiveAt > now
      ? plan.cancelEffectiveAt.toISOString()
      : null;
  const pausedUntil =
    plan.status === "PAUSED" && plan.pausedUntil && plan.pausedUntil > now ? plan.pausedUntil.toISOString() : null;
  const switchOffer =
    switchTierId && cheaper.kind === "cheaper_plan" && cheaper.tier.id === switchTierId ? cheaper : null;

  return (
    <CustomerShell
      tradingName={brandName(plan.engineer)}
      legalLine={tradingNameOf(plan.engineer)}
      sub={`Manage plan · ${plan.ref}`}
    >
      <CancelFlow
        token={token}
        status={plan.status}
        brand={brand}
        firstName={plan.customer.firstName}
        tierName={tier?.name ?? "care"}
        priceMonthlyPence={plan.priceMonthlyPence ?? 0}
        vatRegistered={plan.engineer.vatRegistered}
        endingOn={endingOn}
        pausedUntil={pausedUntil}
        includes={tier?.clauses.map((c) => c.title) ?? []}
        serviceDue={serviceDue}
        cheaper={cheaper.kind === "cheaper_plan" ? { ...cheaper.tier, savingPence: cheaper.savingPence } : null}
        switchOffer={Boolean(switchOffer)}
        figures={figures}
        passportLine={plan.passportId ? PASSPORT_FREEZE_LINE : null}
        warrantyLine={WARRANTY_LINE}
      />
    </CustomerShell>
  );
}
