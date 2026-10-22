import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { JOIN_BTN } from "@/components/plan-tier-card";
import { undoCancellation, longDate } from "@/lib/cancel-plan";
import { planLinkUrl } from "@/lib/public-url";
import { track } from "@/lib/track";

// Retention spec, sections 2 and 9 — the one-tap "Rejoin" link from the
// cancellation email and the win-back texts. Before the end date it simply
// keeps the plan going; after it, the customer starts a fresh signup with
// the same engineer. The page needs a tap (not a bare GET) so link
// scanners in mail apps can't rejoin anyone by accident.
const CARD = "rounded-2xl bg-white p-4 text-[#0B1A2E] text-center";

export default async function RejoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { token } = await params;
  const { done } = await searchParams;
  const plan = await prisma.plan.findUnique({
    where: { rejoinToken: token },
    include: { engineer: true, customer: true },
  });
  if (!plan) notFound();

  const brand = brandName(plan.engineer);
  const stillRunning =
    plan.status !== "CANCELLED" && plan.cancelEffectiveAt !== null && plan.cancelEffectiveAt > new Date();
  const kept = plan.status !== "CANCELLED" && !plan.cancelRequestedAt;
  const engineerGone = Boolean(plan.engineer.leftAt || plan.engineer.deletedAt);

  async function keepPlan() {
    "use server";
    const result = await undoCancellation(plan!.id, "customer");
    if (result.ok) await track("plan_rejoined", { type: "CUSTOMER", id: plan!.customerId }, { planId: plan!.id, via: "rejoin_link" });
    redirect(`/rejoin/${token}?done=1`);
  }

  return (
    <CustomerShell tradingName={brand} legalLine={tradingNameOf(plan.engineer)} sub={`Rejoin · ${plan.ref}`}>
      {kept ? (
        <>
          <div className={CARD}>
            <p className="font-semibold text-[17px]">{done ? "You're staying on your plan" : "Your plan is still running"}</p>
            <p className="text-[13px] mt-1.5 text-[#5B6B82]">Nothing more to do. Thanks for staying with {brand}.</p>
          </div>
          <Link href={`/portal/${plan.portalToken}`} className={JOIN_BTN}>
            View my plan
          </Link>
        </>
      ) : stillRunning ? (
        <>
          <div className={CARD}>
            <p className="font-semibold text-[17px]">Keep your plan with {brand}?</p>
            <p className="text-[13px] mt-1.5 text-[#5B6B82]">
              Your plan is due to end on {longDate(plan.cancelEffectiveAt!)}. Rejoin and it carries on as normal, with
              the same price and payments.
            </p>
          </div>
          <form action={keepPlan}>
            <button type="submit" className={JOIN_BTN}>
              Rejoin
            </button>
          </form>
        </>
      ) : engineerGone ? (
        <div className={CARD}>
          <p className="font-semibold text-[17px]">{brand} no longer offers plans on TradeSura</p>
          <p className="text-[13px] mt-1.5 text-[#5B6B82]">
            <Link href={`/portal/${plan.portalToken}/nearby`} className="underline">
              See other TradeSura engineers near you
            </Link>
          </p>
        </div>
      ) : (
        <>
          <div className={CARD}>
            <p className="font-semibold text-[17px]">Welcome back, {plan.customer.firstName}</p>
            <p className="text-[13px] mt-1.5 text-[#5B6B82]">
              Your old plan has ended, so rejoining takes a fresh signup with {brand}. It only takes a minute.
            </p>
          </div>
          <a href={`${planLinkUrl(plan.engineer.slug)}?rejoin=${token}`} className={JOIN_BTN}>
            See {brand}&apos;s plans
          </a>
        </>
      )}
    </CustomerShell>
  );
}
