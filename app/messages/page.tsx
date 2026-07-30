import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkEmergency } from "@/lib/compliance/interlock";
import { AppShell } from "@/components/shells";
import { Card, Micro, Pill } from "@/components/ui";

type Triage = { label: string; tone: "danger" | "warn" | "info" | "off"; rank: number };

// Safety first, then no-heat, then everything else (handover 1.5).
function triage(message: string, emergency: boolean): Triage {
  if (emergency) return { label: "EMERGENCY", tone: "danger", rank: 0 };
  if (/no heat|cold|not work|won'?t (start|fire)|no hot water/i.test(message)) {
    return { label: "NO HEAT — PRIORITY", tone: "warn", rank: 1 };
  }
  if (/reschedul|move|change.*(date|time|day)|cancel.*appointment/i.test(message)) {
    return { label: "RESCHEDULE", tone: "info", rank: 2 };
  }
  return { label: "QUESTION", tone: "off", rank: 3 };
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
      const meta = r.meta as { planId?: string; message?: string; emergency?: boolean } | null;
      const plan = meta?.planId ? planById.get(meta.planId) : undefined;
      if (!plan) return null; // another engineer's ticket
      const message = meta?.message ?? "";
      // Older rows predate the stored flag — re-run the check so no safety
      // event is ever mis-tagged.
      const emergency = meta?.emergency ?? checkEmergency(message).emergency;
      return {
        id: r.id,
        no: reports.length - i,
        ts: r.ts,
        message,
        customerName: `${plan.customer.firstName} ${plan.customer.lastName}`,
        // Coverage is irrelevant to a safety event and must never be shown.
        covered: !emergency && plan.status === "ACTIVE",
        tag: triage(message, emergency),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => a.tag.rank - b.tag.rank || b.ts.getTime() - a.ts.getTime());

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
          Safety events sort to the top and never carry a coverage tag. Other tickets auto-tag by
          type and against the customer&apos;s plan. Replies go by text from your phone for now;
          in-app threads are coming.
        </p>
      </Card>
    </AppShell>
  );
}
