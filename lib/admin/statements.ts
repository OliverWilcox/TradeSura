import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { notFound } from "@/lib/admin-api/route";
import { buildStatement, isMonth, monthLabel } from "@/lib/fee-statement";

const live = { deletedAt: null } satisfies Prisma.EngineerWhereInput;

const MONTHS_LISTED = 24;
const AT_ONCE = 6;

async function mustExist(engineerId: string) {
  const e = await prisma.engineer.findFirst({ where: { id: engineerId, ...live }, select: { id: true } });
  if (!e) throw notFound("There's no engineer with that ID.");
}

async function monthsWithActivity(engineerId: string) {
  const rows = await prisma.$queryRaw<{ month: string }[]>`
    SELECT DISTINCT month FROM (
      SELECT to_char(ts AT TIME ZONE 'Europe/London', 'YYYY-MM') AS month
      FROM "Event" WHERE name = 'payment_confirmed' AND meta->>'engineerId' = ${engineerId}
      UNION ALL
      SELECT to_char(e.ts AT TIME ZONE 'Europe/London', 'YYYY-MM') AS month
      FROM "Event" e JOIN "Plan" p ON p.id = e.meta->>'planId'
      WHERE e.name = 'yearly_refund' AND p."engineerId" = ${engineerId}
    ) m ORDER BY month DESC`;
  return rows.map((r) => r.month).filter(isMonth);
}

export async function engineerStatementMonths(engineerId: string) {
  await mustExist(engineerId);
  const months = (await monthsWithActivity(engineerId)).slice(0, MONTHS_LISTED);
  const items: { month: string; label: string; number: string; collections: number; refunds: number; collectedPence: number; feePence: number; feeRefundedPence: number; netFeePence: number; toYouPence: number }[] = [];
  for (let i = 0; i < months.length; i += AT_ONCE) {
    const built = await Promise.all(months.slice(i, i + AT_ONCE).map((m) => buildStatement(engineerId, m)));
    for (const s of built) {
      items.push({ month: s.month, label: monthLabel(s.month), number: s.number, collections: s.lines.length, refunds: s.refunds.length, ...s.totals });
    }
  }
  return { items };
}

export async function engineerStatement(engineerId: string, month: string) {
  await mustExist(engineerId);
  const s = await buildStatement(engineerId, month);
  return { ...s, label: monthLabel(s.month) };
}
