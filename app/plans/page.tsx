import Link from "next/link";
import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shells";
import { Card, Micro, Money, Pill } from "@/components/ui";
import { PresetButton } from "@/components/preset-button";

export default async function PlansPage() {
  const engineer = await requireEngineer();
  const tiers = await prisma.planTier.findMany({
    where: { engineerId: engineer.id, archived: false },
    orderBy: { sortOrder: "asc" },
    include: { clauses: { include: { clause: true } }, _count: { select: { plans: true } } },
  });

  return (
    <AppShell active="PLANS" topRight={<Micro>Plan builder</Micro>}>
      {tiers.length === 0 ? (
        <>
          <Card className="bg-flame-tint border-[#BBDCF4]">
            <p className="text-xs text-flame-deep">
              <b>Legal wording locked in.</b> Your plan uses solicitor-approved
              maintenance-and-priority terms. Breakdown-repair promises are insurance — TradeSura
              keeps you on the right side of the line automatically.
            </p>
          </Card>
          <PresetButton />
        </>
      ) : (
        <>
          {tiers.map((t) => (
            <Link key={t.id} href={`/plans/${t.id}`}>
              <Card className={t.isRecommended ? "border-copper" : ""}>
                <div className="flex justify-between items-baseline">
                  <h2 className="font-disp text-lg uppercase tracking-wide">{t.name}</h2>
                  <Money pence={t.priceMonthlyPence} suffix="/mo" />
                </div>
                <p className="text-xs text-muted mt-1">
                  {t.clauses.map((tc) => tc.clause.title).join(" · ")}
                  {t.customLabels.length > 0 && ` · ${t.customLabels.join(" · ")}`}
                </p>
                <div className="mt-2 flex gap-1.5">
                  {t.isRecommended && <Pill tone="info">MOST CHOSEN</Pill>}
                  <Pill tone={t._count.plans > 0 ? "ok" : "off"}>
                    {t._count.plans} ON THIS TIER
                  </Pill>
                </div>
              </Card>
            </Link>
          ))}
          {tiers.length < 3 && <PresetButton blank />}
        </>
      )}
    </AppShell>
  );
}
