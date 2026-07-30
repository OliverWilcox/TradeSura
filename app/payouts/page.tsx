import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeMonthlyPence } from "@/lib/plans";
import { appFeePence } from "@/lib/clauses";
import { AppShell } from "@/components/shells";
import { Card, Micro, Pill, RowLine } from "@/components/ui";

function pounds(pence: number) {
  return `£${(pence / 100).toFixed(2)}`;
}

export default async function PayoutsPage() {
  const engineer = await requireEngineer();
  const { totalPence, count } = await activeMonthlyPence(engineer.id);
  const fee = appFeePence(totalPence);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [confirmed, failedEvents] = await Promise.all([
    prisma.event.count({
      where: { name: "payment_confirmed", ts: { gte: monthStart }, meta: { path: ["engineerId"], equals: engineer.id } },
    }),
    prisma.event.findMany({
      where: { name: "payment_failed", ts: { gte: thirtyDaysAgo }, meta: { path: ["engineerId"], equals: engineer.id } },
      orderBy: { ts: "desc" },
    }),
  ]);

  const failedPlanIds = [
    ...new Set(
      failedEvents
        .map((e) => (e.meta as { planId?: string } | null)?.planId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const failedPlans = await prisma.plan.findMany({
    where: { id: { in: failedPlanIds } },
    include: { customer: true },
  });

  return (
    <AppShell active="MORE" topRight={<Micro>Payouts</Micro>}>
      <Card>
        <h2 className="text-sm font-semibold mb-1">Expected monthly payout</h2>
        <div className="font-mono text-3xl font-semibold text-copper">
          {pounds(totalPence - fee)}
        </div>
        <p className="text-xs text-muted mt-1">
          {count} active plan{count === 1 ? "" : "s"} · paid out direct to your bank
        </p>
        <p className="text-[11px] text-faint mt-1">
          The live payout feed switches on once the payment provider is connected; until then
          this is the maths of your active plans.
        </p>
      </Card>

      <Card>
        <Micro className="mb-1.5">This month, transparently</Micro>
        <RowLine left="Plan collections (expected)" right={<span className="font-mono">{pounds(totalPence)}</span>} />
        <RowLine left="TradeSura fee (20%)" right={<span className="font-mono">−{pounds(fee)}</span>} />
        <RowLine left="Collections confirmed" right={<span className="font-mono">{confirmed}</span>} />
        <RowLine
          left={<b>To your bank (before DD costs)</b>}
          right={<b className="font-mono text-copper">{pounds(totalPence - fee)}</b>}
        />
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-1">Failed collection recovery</h2>
        {failedPlans.length === 0 ? (
          <p className="text-xs text-muted py-1">No failed collections in the last 30 days.</p>
        ) : (
          failedPlans.map((p) => (
            <div
              key={p.id}
              className="flex justify-between items-center gap-2 py-2.5 border-b border-line-soft last:border-b-0"
            >
              <div>
                <b className="text-sm">
                  {p.customer.firstName} {p.customer.lastName} · {pounds(p.priceMonthlyPence ?? 0)}
                </b>
                <br />
                <Micro>GOCARDLESS RETRIES AUTOMATICALLY</Micro>
              </div>
              <Pill tone="warn">AUTO</Pill>
            </div>
          ))
        )}
        <p className="text-xs text-muted mt-1.5">
          Smart retries run automatically; most failures recover themselves.
        </p>
      </Card>

      <Card>
        <a href="/api/payouts/export" className="block">
          <RowLine left="Tax-year export (CSV)" right={<Pill tone="info">DOWNLOAD</Pill>} />
        </a>
      </Card>
    </AppShell>
  );
}
