import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/shells";
import { Card, Micro, Pill } from "@/components/ui";

type Triage = { label: string; tone: "warn" | "info" | "off" };

function triage(message: string): Triage {
  if (/no heat|cold|not work|won'?t (start|fire)|no hot water/i.test(message)) {
    return { label: "NO HEAT — PRIORITY", tone: "warn" };
  }
  if (/reschedul|move|change.*(date|time|day)|cancel.*appointment/i.test(message)) {
    return { label: "RESCHEDULE", tone: "info" };
  }
  return { label: "QUESTION", tone: "off" };
}

export default async function MessagesPage() {
  const engineer = await requireEngineer();

  // Tickets are problem reports from the customer portal.
  // ponytail: no reply threads yet — replies happen by text from the
  // engineer's phone; threads arrive with the messaging backend
  const reports = await prisma.event.findMany({
    where: { name: "problem_reported" },
    orderBy: { ts: "desc" },
    take: 100,
  });
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentEmergencies = await prisma.event.count({
    where: { name: "emergency_interlock_triggered", ts: { gte: sevenDaysAgo } },
  });

  const planIds = [
    ...new Set(
      reports
        .map((r) => (r.meta as { planId?: string } | null)?.planId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const plans = await prisma.plan.findMany({
    where: { id: { in: planIds }, engineerId: engineer.id },
    include: { customer: true },
  });
  const planById = new Map(plans.map((p) => [p.id, p]));

  const tickets = reports
    .map((r, i) => {
      const meta = r.meta as { planId?: string; message?: string } | null;
      const plan = meta?.planId ? planById.get(meta.planId) : undefined;
      if (!plan) return null; // another engineer's ticket
      return {
        id: r.id,
        no: reports.length - i,
        ts: r.ts,
        message: meta?.message ?? "",
        customerName: `${plan.customer.firstName} ${plan.customer.lastName}`,
        covered: plan.status === "ACTIVE",
        tag: triage(meta?.message ?? ""),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => (a.tag.tone === "warn" ? -1 : 0) - (b.tag.tone === "warn" ? -1 : 0));

  return (
    <AppShell active="MORE" topRight={<Micro>Messages</Micro>}>
      {recentEmergencies > 0 && (
        <div className="bg-danger-tint border border-[#F1BDBD] text-[#8F2323] rounded-[10px] px-3 py-2.5 text-xs font-semibold">
          ⚠ GAS EMERGENCY WORDING TRIGGERED this week — the customer was shown the emergency
          script and told to call 0800 111 999 before anything else.
        </div>
      )}

      {tickets.length === 0 ? (
        <Card className="text-center py-8">
          <p className="font-semibold">No messages yet</p>
          <p className="text-xs text-muted mt-1.5">
            Problem reports from your plan customers land here, triaged automatically.
          </p>
        </Card>
      ) : (
        <Card>
          {tickets.map((t) => (
            <div key={t.id} className="py-2.5 border-b border-line-soft last:border-b-0">
              <div className="flex justify-between items-start gap-2">
                <div>
                  <b className="text-sm">{t.customerName}</b>
                  <p className="text-xs text-muted mt-0.5">
                    &ldquo;{t.message.slice(0, 90)}
                    {t.message.length > 90 ? "…" : ""}&rdquo;
                  </p>
                </div>
                <Pill tone="info">TICKET #{t.no}</Pill>
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <Pill tone={t.tag.tone}>{t.tag.label}</Pill>
                {t.covered && <Pill tone="ok">COVERED BY PLAN</Pill>}
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <h2 className="text-sm font-semibold mb-1">Smart triage on every ticket</h2>
        <p className="text-xs text-muted">
          Tickets auto-tag by type and against the customer&apos;s plan — no-heat cases surface
          first. Replies go by text from your phone for now; in-app threads are coming.
        </p>
      </Card>
    </AppShell>
  );
}
