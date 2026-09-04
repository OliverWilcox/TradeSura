import { getEngineerId } from "@/lib/auth";
import { prisma } from "@/lib/db";

function csvField(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Accountant-ready plan export. Payment-level rows arrive with the live
// Stripe payouts feed.
export async function GET() {
  const engineerId = await getEngineerId();
  if (!engineerId) return new Response("Not signed in.", { status: 401 });

  const plans = await prisma.plan.findMany({
    where: { engineerId },
    include: { customer: true, tier: true },
    orderBy: { createdAt: "asc" },
  });

  const rows = [
    "plan_ref,customer,tier,monthly_price_gbp,status,activated,cancelled",
    ...plans.map((p) =>
      [
        p.ref,
        csvField(`${p.customer.firstName} ${p.customer.lastName}`),
        p.tier?.name ?? "",
        p.priceMonthlyPence != null ? (p.priceMonthlyPence / 100).toFixed(2) : "",
        p.status,
        p.activatedAt?.toISOString().slice(0, 10) ?? "",
        p.cancelledAt?.toISOString().slice(0, 10) ?? "",
      ].join(","),
    ),
  ];

  return new Response(rows.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="tradeshura-plans-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
