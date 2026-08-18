import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { checkEmergency } from "@/lib/compliance/interlock";

type Tag = { label: string; tone: "danger" | "warn" | "info" | "off"; rank: number };

// Safety first, then no-heat, then everything else (handover 1.5).
function triage(message: string, emergency: boolean): Tag {
  if (emergency) return { label: "EMERGENCY", tone: "danger", rank: 0 };
  if (/no heat|cold|not work|won'?t (start|fire)|no hot water/i.test(message)) {
    return { label: "NO HEAT — PRIORITY", tone: "warn", rank: 1 };
  }
  if (/reschedul|move|change.*(date|time|day)|cancel.*appointment/i.test(message)) {
    return { label: "RESCHEDULE", tone: "info", rank: 2 };
  }
  return { label: "QUESTION", tone: "off", rank: 3 };
}

// Mobile counterpart to app/messages/page.tsx (restored — see CLAUDE.md's
// 2026-08-03 scope note). This is the engineer's only visibility into
// customer-reported problems, including when the gas-emergency interlock
// fired — keep the emergency banner and the never-tag-a-safety-event-as-
// covered rule intact if this changes again.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

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
    where: { id: { in: planIds }, engineerId },
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
        ts: r.ts.toISOString(),
        message,
        customerName: `${plan.customer.firstName} ${plan.customer.lastName}`,
        // Coverage is irrelevant to a safety event and must never be shown.
        covered: !emergency && plan.status === "ACTIVE",
        tag: triage(message, emergency),
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .sort((a, b) => a.tag.rank - b.tag.rank || new Date(b.ts).getTime() - new Date(a.ts).getTime());

  return NextResponse.json({ tickets, recentEmergencies });
}
