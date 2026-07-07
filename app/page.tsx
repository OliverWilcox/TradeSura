import Link from "next/link";
import { redirect } from "next/navigation";
import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeMonthlyPence } from "@/lib/plans";
import { dueServices } from "@/lib/reminders";
import { AppShell } from "@/components/shells";
import { Card, Micro, Pill, RowLine, btnClass } from "@/components/ui";

export default async function DashboardPage() {
  const engineer = await requireEngineer();
  if (!engineer.gasSafeVerifiedAt) redirect("/onboarding");

  const { totalPence, count } = await activeMonthlyPence(engineer.id);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newThisMonth = await prisma.plan.count({
    where: { engineerId: engineer.id, status: "ACTIVE", activatedAt: { gte: monthStart } },
  });

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const failedRecently = await prisma.event.count({
    where: {
      name: "payment_failed",
      ts: { gte: thirtyDaysAgo },
      meta: { path: ["engineerId"], equals: engineer.id },
    },
  });
  // ponytail: burner turns amber at 2+ failures in 30 days; tune with real data
  const healthy = failedRecently < 2;

  const customersTotal = await prisma.customer.count({ where: { engineerId: engineer.id } });
  const onPlan = await prisma.customer.count({
    where: { engineerId: engineer.id, plans: { some: { status: "ACTIVE" } } },
  });
  const noPlan = customersTotal - onPlan;
  const avgTier = await prisma.planTier.aggregate({
    where: { engineerId: engineer.id, archived: false },
    _avg: { priceMonthlyPence: true },
  });
  const avgPence = Math.round(avgTier._avg.priceMonthlyPence ?? 1200);
  // Opportunity: converting 1 in 5 of the no-plan book at the average tier.
  const prizeYearlyPence = Math.round((noPlan / 5) * avgPence * 12);

  const now = new Date();
  const upcoming = (await dueServices(engineer.id)).filter((d) => d.dueDate >= now).slice(0, 3);

  const monogram = (engineer.tradingName ?? engineer.email)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <AppShell
      active="HOME"
      topRight={
        <span className="w-7 h-7 rounded-full bg-iron text-white flex items-center justify-center font-mono text-[11px]">
          {monogram}
        </span>
      }
    >
      <div className="bg-gradient-to-b from-iron-2 to-iron text-white rounded-[14px] p-4 border border-[#39434f]">
        <Micro className="!text-[#8FA0B0]">
          Locked-in income{" "}
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full align-middle ml-1 ${healthy ? "bg-flame shadow-[0_0_0_4px_rgba(14,127,208,0.25)] animate-pulse" : "bg-warn shadow-[0_0_0_4px_rgba(221,154,20,0.25)]"}`}
          />
        </Micro>
        <div className="font-mono text-[34px] font-semibold text-[#F3B27E] leading-tight mt-1">
          £{(totalPence / 100).toFixed(0)}
          <span className="text-base text-[#C9A17E]">/mo</span>
        </div>
        <p className="text-xs text-[#AEB9C4] mt-0.5">
          = <b className="text-[#F3B27E]">£{((totalPence * 12) / 100).toFixed(0)} a year</b> ·{" "}
          {count} active plan{count === 1 ? "" : "s"} · +{newThisMonth} this month
        </p>
      </div>

      <Card>
        <RowLine
          left="New plans this month"
          right={<Pill tone={newThisMonth > 0 ? "ok" : "off"}>▲ {newThisMonth} NEW</Pill>}
        />
        <RowLine
          left="Failed collections (30 days)"
          right={
            failedRecently > 0 ? (
              <Pill tone="warn">{failedRecently} — retrying</Pill>
            ) : (
              <Pill tone="ok">NONE</Pill>
            )
          }
        />
      </Card>

      <Card>
        <div className="flex justify-between items-baseline mb-1">
          <h2 className="text-sm font-semibold">Upcoming appointments</h2>
          <Link href="/jobs" className="text-flame-deep text-xs font-semibold">
            View all →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-xs text-muted py-1">
            Nothing booked yet — service dates appear here from plan signups and your customer
            import.
          </p>
        ) : (
          upcoming.map((d, i) => (
            <RowLine
              key={i}
              left={
                <>
                  <b>{d.customerName}</b>
                  <span className="block font-mono text-[10px] uppercase text-faint">
                    Annual service{d.tierName ? ` · ${d.tierName} plan` : " · no plan"}
                  </span>
                </>
              }
              right={
                <span className="font-mono text-xs">
                  {d.dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                </span>
              }
            />
          ))
        )}
      </Card>

      {noPlan > 0 && (
        <Card className="bg-copper-tint border-[#EBCDB8]">
          <h2 className="text-sm font-semibold text-copper-deep">
            You&apos;re leaving money on the van
          </h2>
          <p className="text-xs text-[#7A4A26] mt-1">
            {noPlan} customer{noPlan === 1 ? "" : "s"} in your book {noPlan === 1 ? "has" : "have"}{" "}
            no plan. Converting 1 in 5 adds{" "}
            <b className="font-mono">£{(prizeYearlyPence / 100).toFixed(0)}/yr</b>.
          </p>
        </Card>
      )}

      <div className="flex-1" />
      <Link href="/doorstep" className={btnClass("copper")}>
        Offer a plan — 90 second signup
      </Link>
    </AppShell>
  );
}
