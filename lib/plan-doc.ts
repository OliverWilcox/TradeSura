// Plan document assembly — ONLY from the clause templates table
// (CLAUDE.md §Compliance 1). No free text enters this document.
import { prisma } from "@/lib/db";
import { EMERGENCY_LINE } from "@/lib/compliance/interlock";
import { resolvePlanTier } from "@/lib/plan-tier";
import { appUrl } from "@/lib/app-url";
import { perMonth, tradingNameOf } from "@/lib/engineer";

export function poundsFromPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

export async function getPlanDocument(planId: string) {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { id: planId },
    include: {
      engineer: true,
      customer: true,
      tier: { include: { clauses: { include: { clause: true } } } },
    },
  });
  // Resolves to the agreed snapshot when the customer joined a versioned
  // tier, else the live tier — never a mix.
  const tier = resolvePlanTier(plan);
  const clauses = tier?.clauses ?? [];
  return { plan, tier, clauses };
}

export async function planDocumentEmailHtml(planId: string) {
  const { plan, tier, clauses } = await getPlanDocument(planId);
  const brand = plan.engineer.tradingName?.trim() || plan.engineer.legalName?.trim() || "Your engineer";
  const legalLine = tradingNameOf(plan.engineer);
  const price = poundsFromPence(plan.priceMonthlyPence ?? 0);
  const portalUrl = `${appUrl()}/portal/${plan.portalToken}`;
  const coolingOffEnds = plan.coolingOffEndsAt?.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const clauseHtml = clauses
    .map((c) => `<h3 style="margin:14px 0 4px">${c.title}</h3><p style="margin:0">${c.bodyText}</p>`)
    .join("\n");

  return {
    // The customer's questions go to their engineer, not TradeSura.
    replyTo: plan.engineer.email,
    subject: `Your ${brand} care plan — ${tier?.name ?? ""} (${plan.ref})`,
    html: `
<div style="font-family:sans-serif;max-width:560px">
  <h1 style="margin-bottom:2px">${brand} Care Plans</h1>
  <p style="color:#5E6975;margin-top:0">Plan ${plan.ref} · ${plan.customer.firstName} ${plan.customer.lastName}</p>
  <p><b>You're on the ${tier?.name ?? ""} plan</b> — ${perMonth(price, plan.engineer.vatRegistered, "/month")} by Direct Debit.</p>
  <h2>What your plan includes</h2>
  ${clauseHtml}
  <h2>What's not included</h2>
  <p style="margin:0"><b>Breakdown repairs.</b> If something breaks, your engineer prioritises you
  and repair work is chargeable at your plan discount. This plan is a maintenance &amp; priority
  agreement, not an insurance policy.</p>
  <h2>Your rights</h2>
  <p>You have a <b>14-day cooling-off period</b>${coolingOffEnds ? ` (until ${coolingOffEnds})` : ""}:
  cancel within it for a full refund of any payment taken. You can cancel at any time after that
  in two taps from your plan page — no phone calls, no hoops. Your payments are protected by the
  Direct Debit Guarantee.</p>
  <p><a href="${portalUrl}">View or manage your plan</a></p>
  <p style="color:#8B95A1;font-size:12px">Smell gas? Call the National Gas Emergency line free: ${EMERGENCY_LINE}.
  ${brand} Care Plans — powered by TradeSura.${legalLine ? `<br>${legalLine}.` : ""}</p>
</div>`,
  };
}
