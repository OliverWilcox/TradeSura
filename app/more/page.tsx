import Link from "next/link";
import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeMonthlyPence } from "@/lib/plans";
import { appFeePence } from "@/lib/clauses";
import { AppShell, GasSafeBadge } from "@/components/shells";
import { Card, Micro, Pill, RowLine } from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";
import { FlushSmsButton, SignOutButton } from "@/components/more-actions";

export default async function MorePage() {
  const engineer = await requireEngineer();
  const { totalPence, count } = await activeMonthlyPence(engineer.id);
  const fee = appFeePence(totalPence);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [confirmed, failed, queuedSms] = await Promise.all([
    prisma.event.count({
      where: { name: "payment_confirmed", ts: { gte: monthStart }, meta: { path: ["engineerId"], equals: engineer.id } },
    }),
    prisma.event.count({
      where: { name: "payment_failed", ts: { gte: monthStart }, meta: { path: ["engineerId"], equals: engineer.id } },
    }),
    prisma.outboundSms.count({ where: { engineerId: engineer.id, status: "QUEUED" } }),
  ]);

  return (
    <AppShell active="MORE" topRight={<Micro>More</Micro>}>
      <Card>
        <h2 className="text-sm font-semibold mb-1">Your business</h2>
        <div className="py-1.5">
          {engineer.gasSafeNo && engineer.gasSafeVerifiedAt ? (
            <GasSafeBadge regNo={engineer.gasSafeNo} />
          ) : (
            <Link href="/onboarding" className="text-flame-deep text-sm font-semibold">
              Finish Gas Safe verification →
            </Link>
          )}
        </div>
        <SettingsForm
          tradingName={engineer.tradingName ?? ""}
          logoUrl={engineer.logoUrl ?? ""}
          slug={engineer.slug}
        />
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-1">GoCardless (sandbox)</h2>
        {engineer.gcOrganisationId ? (
          <RowLine
            left="Connection"
            right={<Pill tone="ok">CONNECTED · {engineer.gcOrganisationId.slice(0, 10)}…</Pill>}
          />
        ) : (
          <a href="/api/gc/connect" className="text-flame-deep text-sm font-semibold">
            Connect GoCardless →
          </a>
        )}
      </Card>

      <Card>
        <Micro className="mb-1.5">This month, transparently</Micro>
        <RowLine
          left="Expected plan collections"
          right={<span className="font-mono">£{(totalPence / 100).toFixed(2)}</span>}
        />
        <RowLine
          left="Planlock fee (20%)"
          right={<span className="font-mono">−£{(fee / 100).toFixed(2)}</span>}
        />
        <RowLine
          left={<b>To your bank (before DD costs)</b>}
          right={<b className="font-mono text-copper">£{((totalPence - fee) / 100).toFixed(2)}</b>}
        />
        <RowLine
          left="Collections confirmed / failed"
          right={
            <span className="font-mono text-xs">
              {confirmed} / {failed}
            </span>
          }
        />
        <p className="text-[11px] text-faint mt-1">
          Across {count} active plan{count === 1 ? "" : "s"} · full payout detail is coming soon.
        </p>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-1">Message queue (dev)</h2>
        <RowLine left="Queued texts (nudges, reminders, quiet hours)" right={<Pill tone={queuedSms > 0 ? "info" : "off"}>{queuedSms}</Pill>} />
        <FlushSmsButton />
      </Card>

      <Card>
        <RowLine left={<Link href="/campaigns" className="text-flame-deep">Campaigns</Link>} right={<Pill tone="off">SOON</Pill>} />
        <RowLine left={<Link href="/payouts" className="text-flame-deep">Payouts detail</Link>} right={<Pill tone="off">SOON</Pill>} />
      </Card>

      <SignOutButton />
      <Micro className="text-center">Signed in as {engineer.email}</Micro>
    </AppShell>
  );
}
