import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CustomerShell } from "@/components/shells";
import { Card, NotIncluded, Pill, RowLine } from "@/components/ui";
import { poundsFromPence } from "@/lib/plan-doc";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: {
      engineer: true,
      customer: { include: { properties: { include: { appliances: true } } } },
      tier: { include: { clauses: { include: { clause: true } } } },
    },
  });
  if (!plan) notFound();

  const brand = plan.engineer.tradingName ?? plan.engineer.slug;
  const firstName = plan.engineer.gasSafeName?.split(" ").at(-1) ?? brand;
  const clauses = (plan.tier?.clauses ?? [])
    .map((tc) => tc.clause)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const property = plan.customer.properties[0];
  const nextService = plan.activatedAt
    ? new Date(new Date(plan.activatedAt).setFullYear(plan.activatedAt.getFullYear() + 1))
    : null;

  return (
    <CustomerShell
      tradingName={brand}
      sub={`Plan ${plan.ref} · ${plan.customer.firstName} ${plan.customer.lastName}${property ? ` · ${property.addressLine1}` : ""}`}
    >
      {plan.status === "ACTIVE" ? (
        // C4 — raised plan-status card with the breakdown inside it.
        <Card variant="raised">
          <div className="flex justify-between items-baseline">
            <p className="font-semibold">
              {plan.tier?.name} — {brand}
            </p>
            <span className="font-mono font-semibold">
              {poundsFromPence(plan.priceMonthlyPence ?? 0)}/mo
            </span>
          </div>
          <div className="h-px bg-line-strong my-2.5" />
          <RowLine left="Direct Debit" right={<span className="text-ok font-semibold">Active</span>} />
          {nextService && (
            <RowLine
              left="Annual service"
              right={nextService.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
            />
          )}
        </Card>
      ) : plan.status === "CANCELLED" ? (
        <Card className="text-center py-5">
          <p className="font-semibold">This plan is cancelled</p>
          <p className="text-xs text-muted mt-1">
            Changed your mind? Ask {brand} to send you a new signup link.
          </p>
        </Card>
      ) : (
        <Card className="text-center py-5">
          <p className="font-semibold">Your plan isn&apos;t active yet</p>
          <p className="text-xs text-muted mt-1">Finish signup from the link you were sent.</p>
        </Card>
      )}

      {clauses.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold mb-1">What your plan includes</h2>
          {clauses.map((c) => (
            <RowLine
              key={c.id}
              left={
                <>
                  <span className="text-ok font-bold mr-1.5">✓</span>
                  {c.title}
                </>
              }
              right={
                c.code === "ANNUAL_SERVICE" && nextService ? (
                  <span className="font-mono text-[10px] uppercase text-faint">
                    NEXT:{" "}
                    {nextService.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                  </span>
                ) : undefined
              }
            />
          ))}
        </Card>
      )}

      {clauses.length > 0 && <NotIncluded />}

      {plan.status === "ACTIVE" && (
        <Card>
          <Link href={`/portal/${token}/report`} className="block">
            <RowLine left="Report a problem" right={<Pill tone="info">START</Pill>} />
          </Link>
          <Link href={`/portal/${token}/manage`} className="block">
            <RowLine left="Manage or cancel plan" right={<Pill tone="off">SETTINGS</Pill>} />
          </Link>
        </Card>
      )}

      <p className="text-xs text-muted text-center">
        Your engineer: {firstName} · {brand}
      </p>
    </CustomerShell>
  );
}
