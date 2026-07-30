import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TRADE_PACKS } from "@/lib/trades";
import { AppShell } from "@/components/shells";
import { Card, Micro } from "@/components/ui";
import { TradeList } from "@/components/trade-list";

export default async function TradesPage() {
  const engineer = await requireEngineer();
  const registered = await prisma.event.findMany({
    where: { name: "trade_interest_registered", actorId: engineer.id },
    select: { meta: true },
  });
  const already = new Set(
    registered.map((e) => (e.meta as { trade?: string } | null)?.trade).filter(Boolean) as string[],
  );

  return (
    <AppShell active="MORE" topRight={<Micro>Trades</Micro>}>
      <Card className="bg-flame-tint border-[#BBDCF4]">
        <p className="text-xs text-flame-deep">
          <b>One pack per trade.</b> A trade only gets a care plan where a recurring service event
          anchors it — that annual visit is what makes the plan honest. Register interest and
          we&apos;ll tell you when your pack&apos;s clause library clears legal review.
        </p>
      </Card>

      <TradeList
        packs={TRADE_PACKS.map((t) => ({
          code: t.code,
          name: t.name,
          anchor: t.anchor,
          live: t.live,
          registered: already.has(t.code),
        }))}
      />
    </AppShell>
  );
}
