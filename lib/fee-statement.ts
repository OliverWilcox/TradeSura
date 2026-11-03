import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { computeApplicationFeePence } from "@/lib/stripe";
import { COMPANY_LINE, escapeHtml } from "@/lib/email-layout";

// Matt, 30 Oct §9.5 — a monthly statement / invoice of TradeSura's 20% fee,
// for the engineer's accountant. No VAT: TradeSura isn't VAT registered.
// Built from the same records as the Payouts tab (payment_confirmed events,
// each fee = Stripe's application fee, 20% rounded down), so it reconciles
// to the penny with what reached their bank.

export type StatementLine = { date: string; customer: string; planRef: string; collectedPence: number; feePence: number };
export type RefundLine = { date: string; customer: string; planRef: string; refundedPence: number; feeRefundedPence: number };
export type Statement = {
  month: string; // YYYY-MM
  number: string;
  issuedOn: string;
  engineer: { name: string; address: string[] };
  lines: StatementLine[];
  refunds: RefundLine[];
  totals: { collectedPence: number; feePence: number; feeRefundedPence: number; netFeePence: number; toYouPence: number };
};

export function isMonth(s: string | null | undefined): s is string {
  return Boolean(s && /^20\d\d-(0[1-9]|1[0-2])$/.test(s));
}

// The month's bounds in UK time.
export function monthBounds(month: string): { start: Date; end: Date } {
  const [y, mo] = month.split("-").map(Number);
  const londonMidnight = (yy: number, mm: number) => {
    const guess = new Date(Date.UTC(yy, mm - 1, 1));
    const offset = guess.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }) === "01" ? 1 : 0;
    return new Date(guess.getTime() - offset * 60 * 60 * 1000);
  };
  return { start: londonMidnight(y, mo), end: mo === 12 ? londonMidnight(y + 1, 1) : londonMidnight(y, mo + 1) };
}

const ukDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
export const monthLabel = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

export function statementTotals(lines: StatementLine[], refunds: RefundLine[]) {
  const collectedPence = lines.reduce((s, l) => s + l.collectedPence, 0);
  const feePence = lines.reduce((s, l) => s + l.feePence, 0);
  const feeRefundedPence = refunds.reduce((s, r) => s + r.feeRefundedPence, 0);
  const refundedPence = refunds.reduce((s, r) => s + r.refundedPence, 0);
  return {
    collectedPence,
    feePence,
    feeRefundedPence,
    netFeePence: feePence - feeRefundedPence,
    // What the month's collections paid the engineer, less their share of refunds.
    toYouPence: collectedPence - feePence - (refundedPence - feeRefundedPence),
  };
}

export async function buildStatement(engineerId: string, month: string, now = new Date()): Promise<Statement> {
  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const { start, end } = monthBounds(month);
  const events = await prisma.event.findMany({
    where: {
      name: { in: ["payment_confirmed", "yearly_refund"] },
      ts: { gte: start, lt: end },
      OR: [{ meta: { path: ["engineerId"], equals: engineerId } }, { name: "yearly_refund" }],
    },
    orderBy: { ts: "asc" },
    select: { name: true, ts: true, meta: true },
  });
  const planIds = [...new Set(events.map((e) => (e.meta as { planId?: string } | null)?.planId).filter((x): x is string => Boolean(x)))];
  const plans = await prisma.plan.findMany({
    where: { id: { in: planIds }, engineerId },
    select: { id: true, ref: true, customer: { select: { firstName: true, lastName: true } } },
  });
  const byId = new Map(plans.map((p) => [p.id, p]));

  const lines: StatementLine[] = [];
  const refunds: RefundLine[] = [];
  for (const e of events) {
    const meta = (e.meta ?? {}) as { planId?: string; amountPence?: number };
    const plan = meta.planId ? byId.get(meta.planId) : undefined;
    if (!plan) continue; // another engineer's refund event
    const customer = `${plan.customer.firstName} ${plan.customer.lastName}`;
    const amount = meta.amountPence ?? 0;
    if (e.name === "payment_confirmed") {
      lines.push({ date: ukDate(e.ts), customer, planRef: plan.ref, collectedPence: amount, feePence: computeApplicationFeePence(amount) });
    } else {
      // Stripe refunds our fee in proportion (refund_application_fee), so
      // the share comes from the yearly collection this refund is part of.
      const charge = await prisma.event.findFirst({
        where: { name: "payment_confirmed", ts: { lt: e.ts }, meta: { path: ["planId"], equals: plan.id } },
        orderBy: { ts: "desc" },
        select: { meta: true },
      });
      const chargePence = (charge?.meta as { amountPence?: number } | null)?.amountPence ?? 0;
      const feeRefundedPence = chargePence > 0 ? Math.round((computeApplicationFeePence(chargePence) * amount) / chargePence) : 0;
      refunds.push({ date: ukDate(e.ts), customer, planRef: plan.ref, refundedPence: amount, feeRefundedPence });
    }
  }

  const address = (engineer.packAddress ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    month,
    number: `TS-${month.replace("-", "")}-${engineer.id.slice(-6).toUpperCase()}`,
    issuedOn: ukDate(now),
    engineer: { name: engineer.legalName?.trim() || brandName(engineer), address: address.length ? address : engineer.postcode ? [engineer.postcode] : [] },
    lines,
    refunds,
    totals: statementTotals(lines, refunds),
  };
}

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;

/** A printable A4 page: the engineer saves it as a PDF from the browser's Share or Print. */
export function statementHtml(s: Statement): string {
  const row = (cells: string[], bold = false) =>
    `<tr>${cells.map((c, i) => `<td style="padding:7px 8px;border-bottom:1px solid #E3E8EF;${i >= 3 ? "text-align:right;" : ""}${bold ? "font-weight:700;" : ""}">${c}</td>`).join("")}</tr>`;
  const lines = s.lines.length
    ? s.lines.map((l) => row([escapeHtml(l.date), escapeHtml(l.customer), escapeHtml(l.planRef), gbp(l.collectedPence), gbp(l.feePence)])).join("")
    : `<tr><td colspan="5" style="padding:10px 8px;color:#5B6B82;">No collections this month.</td></tr>`;
  const refunds = s.refunds.length
    ? `<h2>Refunds</h2><table><thead><tr><th>Date</th><th>Customer</th><th>Plan</th><th style="text-align:right">Refunded</th><th style="text-align:right">Fee refunded</th></tr></thead><tbody>${s.refunds
        .map((r) => row([escapeHtml(r.date), escapeHtml(r.customer), escapeHtml(r.planRef), gbp(r.refundedPence), gbp(r.feeRefundedPence)]))
        .join("")}</tbody></table>`
    : "";
  const t = s.totals;
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TradeSura fee statement ${escapeHtml(monthLabel(s.month))}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#0B1A2E;margin:0;background:#EEF2F7}
  .page{max-width:780px;margin:0 auto;background:#fff;padding:32px 28px}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:15px;margin:26px 0 8px}
  .muted{color:#5B6B82;font-size:13px;line-height:19px}
  .head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:22px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:7px 8px;border-bottom:2px solid #0B1A2E;font-size:12px}
  .totals td{padding:6px 8px;font-size:14px} .totals td:last-child{text-align:right}
  .print{margin-top:22px;padding:12px 18px;border:0;border-radius:10px;background:#0B1A2E;color:#fff;font-size:15px;font-weight:700}
  @media print{body{background:#fff}.page{padding:0}.print{display:none}}
</style></head>
<body><div class="page">
  <div class="head">
    <div>
      <h1>Fee statement and invoice</h1>
      <div class="muted">${escapeHtml(monthLabel(s.month))} · No. ${escapeHtml(s.number)} · Issued ${escapeHtml(s.issuedOn)}</div>
    </div>
    <div class="muted" style="text-align:right">From: TradeSura Ltd<br>Company no. 17325346<br>Unit A3, Gateway Tower<br>32 Western Gateway, London E16 1YL<br>info@tradesura.com</div>
  </div>
  <div class="muted"><b style="color:#0B1A2E">To:</b> ${[s.engineer.name, ...s.engineer.address].map(escapeHtml).join("<br>")}</div>
  <h2>TradeSura's fee on your plan collections (20%)</h2>
  <table><thead><tr><th>Date</th><th>Customer</th><th>Plan</th><th style="text-align:right">Collected</th><th style="text-align:right">Our fee</th></tr></thead><tbody>${lines}</tbody></table>
  ${refunds}
  <h2>Summary</h2>
  <table class="totals"><tbody>
    <tr><td>Collected from your customers</td><td>${gbp(t.collectedPence)}</td></tr>
    <tr><td>TradeSura fee (20%)</td><td>${gbp(t.feePence)}</td></tr>
    ${t.feeRefundedPence ? `<tr><td>Fee refunded on refunds</td><td>−${gbp(t.feeRefundedPence)}</td></tr>` : ""}
    <tr><td><b>Total fee for the month</b></td><td><b>${gbp(t.netFeePence)}</b></td></tr>
    <tr><td>Paid to you</td><td>${gbp(t.toYouPence)}</td></tr>
  </tbody></table>
  <p class="muted" style="margin-top:18px">No VAT is charged: TradeSura is not VAT registered. The fee was taken automatically from each collection, so there is nothing to pay. Stripe's processing costs are paid by TradeSura.</p>
  <p class="muted">${escapeHtml(COMPANY_LINE)}</p>
  <button class="print" onclick="window.print()">Save as PDF or print</button>
</div></body></html>`;
}
