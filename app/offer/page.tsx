import Link from "next/link";
import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shells";
import { Card, Micro } from "@/components/ui";
import { DoorstepStart } from "@/components/doorstep-start";

export default async function DoorstepPage() {
  const engineer = await requireEngineer();
  const customers = await prisma.customer.findMany({
    where: { engineerId: engineer.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, firstName: true, lastName: true, phone: true },
  });
  const tierCount = await prisma.planTier.count({
    where: { engineerId: engineer.id, archived: false },
  });

  return (
    <AppShell active="HOME" topRight={<Micro>Doorstep</Micro>}>
      <Card className="text-center py-5">
        <Micro>Average signup time</Micro>
        <div className="font-mono text-4xl font-semibold text-flame-deep mt-1">0:84</div>
        <p className="text-xs text-muted mt-1">Offer it while the boiler&apos;s still warm.</p>
      </Card>
      {tierCount === 0 ? (
        <Card>
          <p className="text-sm">
            You need at least one plan tier first —{" "}
            <Link href="/plans" className="text-flame-deep font-semibold">
              build your plan
            </Link>
            .
          </p>
        </Card>
      ) : (
        <DoorstepStart customers={customers} />
      )}
    </AppShell>
  );
}
