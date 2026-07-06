import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shells";
import { Card, Micro, Pill } from "@/components/ui";
import { CsvImport } from "@/components/csv-import";

export default async function CustomersPage() {
  const engineer = await requireEngineer();
  const customers = await prisma.customer.findMany({
    where: { engineerId: engineer.id },
    orderBy: { createdAt: "desc" },
    include: {
      plans: { select: { status: true, priceMonthlyPence: true, tier: { select: { name: true } } } },
      properties: { include: { appliances: true } },
    },
  });

  const withStatus = customers.map((c) => {
    const active = c.plans.find((p) => p.status === "ACTIVE");
    const lapsed = !active && c.plans.some((p) => p.status === "CANCELLED");
    return { ...c, active, lapsed };
  });
  const counts = {
    all: withStatus.length,
    onPlan: withStatus.filter((c) => c.active).length,
    lapsed: withStatus.filter((c) => c.lapsed).length,
  };

  return (
    <AppShell active="CUSTOMERS" topRight={<Micro>Customers</Micro>}>
      <Card className="!p-3">
        <div className="flex gap-1.5 flex-wrap">
          <Pill tone="info">ALL {counts.all}</Pill>
          <Pill tone="ok">ON PLAN {counts.onPlan}</Pill>
          <Pill tone="off">NO PLAN {counts.all - counts.onPlan - counts.lapsed}</Pill>
          <Pill tone="warn">LAPSED {counts.lapsed}</Pill>
        </div>
      </Card>

      {withStatus.length > 0 && (
        <Card>
          {withStatus.slice(0, 50).map((c) => {
            const appliance = c.properties[0]?.appliances[0];
            return (
              <div
                key={c.id}
                className="flex justify-between items-center gap-2 py-2 border-b border-line-soft last:border-b-0"
              >
                <div>
                  <b className="text-sm">
                    {c.firstName} {c.lastName}
                  </b>
                  <br />
                  <Micro>
                    {appliance
                      ? `${appliance.make ?? ""} ${appliance.model ?? ""}`.trim().toUpperCase()
                      : c.phone}
                    {appliance?.lastServicedAt &&
                      ` · SERVICED ${appliance.lastServicedAt
                        .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                        .toUpperCase()}`}
                  </Micro>
                </div>
                {c.active ? (
                  <Pill tone="ok">
                    {(c.active.tier?.name ?? "PLAN").toUpperCase()} £
                    {((c.active.priceMonthlyPence ?? 0) / 100).toFixed(0)}
                  </Pill>
                ) : c.lapsed ? (
                  <Pill tone="warn">LAPSED</Pill>
                ) : (
                  <Pill tone="off">NO PLAN</Pill>
                )}
              </div>
            );
          })}
        </Card>
      )}

      <CsvImport />
    </AppShell>
  );
}
