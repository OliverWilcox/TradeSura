import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { nearbyEngineers } from "@/lib/installer-leaves";
import { planLinkUrl } from "@/lib/public-url";

// Retention spec, section 9 — when an installer leaves, their customers get
// this page of TradeSura engineers near them. Choosing one is a fresh signup
// with that engineer; nothing moves without the customer.
const CARD = "rounded-2xl bg-white p-4 text-[#0B1A2E]";

export default async function NearbyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: { engineer: true, customer: { include: { properties: true } } },
  });
  if (!plan) notFound();

  const nearby = await nearbyEngineers({
    excludeEngineerId: plan.engineerId,
    townSlug: plan.engineer.townSlug,
    postcode: plan.customer.properties[0]?.postcode ?? null,
  });

  return (
    <CustomerShell tradingName="TradeSura" sub="Engineers near you">
      <div className={CARD}>
        <h1 className="text-[20px] font-bold leading-tight">Engineers near you</h1>
        <p className="text-[13px] mt-1.5 text-[#5B6B82]">
          {brandName(plan.engineer)}{" "}no longer offers care plans through TradeSura. If you&apos;d like someone else to
          look after your boiler, choose an engineer below and sign up with them. Nothing changes unless you do.
        </p>
      </div>
      {nearby.length === 0 ? (
        <div className={CARD}>
          <p className="text-[14px]">
            We don&apos;t have another engineer in your area yet. We&apos;ll let you know when one joins.
          </p>
        </div>
      ) : (
        nearby.map((e) => (
          <a key={e.id} href={planLinkUrl(e.slug)} className={`${CARD} block`}>
            <p className="text-[17px] font-bold">{e.name}</p>
            {e.town && <p className="text-[13px] text-[#5B6B82]">{e.town}</p>}
            <p className="text-[13px] mt-1.5 text-[#1F5FC4] font-semibold">See their plans →</p>
          </a>
        ))
      )}
    </CustomerShell>
  );
}
