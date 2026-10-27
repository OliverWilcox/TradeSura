import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { brandName, tradingNameOf } from "@/lib/engineer";
import { CustomerShell } from "@/components/shells";
import { Card, NotIncluded, Pill, RowLine, btnClass } from "@/components/ui";
import { annualServiceFrom, annualServiceUnlocked, priceLine } from "@/lib/plan-billing";
import { resolvePlanTier } from "@/lib/plan-tier";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await prisma.plan.findUnique({
    where: { portalToken: token },
    include: {
      engineer: true,
      customer: { include: { properties: { include: { appliances: true } } } },
      tier: { include: { clauses: { include: { clause: true } } } },
      passport: { select: { viewToken: true } },
    },
  });
  if (!plan) notFound();

  const brand = brandName(plan.engineer);
  // "Your engineer: Dave · Dave's Heating"; just the business when there's
  // no first name, never the business twice.
  const engineerFirst = plan.engineer.firstName?.trim();
  const engineerLine = engineerFirst && engineerFirst !== brand ? `${engineerFirst} · ${brand}` : brand;
  // The plan as the customer agreed it (snapshot), else the live tier.
  const tier = resolvePlanTier(plan);
  const clauses = tier?.clauses ?? [];
  const property = plan.customer.properties[0];
  // Retention spec §1 — the annual service opens after the 3rd monthly
  // payment (1st yearly), not a year after joining.
  const serviceOpen = annualServiceUnlocked(plan);
  const serviceFrom = annualServiceFrom(plan);
  const monthYear = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" });
  const serviceLine = serviceOpen ? "Ready to book" : serviceFrom ? `From ${monthYear(serviceFrom)}` : null;

  return (
    <CustomerShell
      tradingName={brand}
      legalLine={tradingNameOf(plan.engineer)}
      sub={`Plan ${plan.ref} · ${plan.customer.firstName} ${plan.customer.lastName}${property ? ` · ${property.addressLine1}` : ""}`}
    >
      {plan.status === "ACTIVE" ? (
        // C4 — raised plan-status card with the breakdown inside it.
        <Card variant="raised">
          <div className="flex justify-between items-baseline">
            <p className="font-semibold">
              {tier?.name} — {brand}
            </p>
            <span className="font-semibold">
              {priceLine(plan.priceMonthlyPence ?? 0, plan.billingInterval, plan.engineer.vatRegistered)}
            </span>
          </div>
          <div className="h-px bg-line-strong my-2.5" />
          <RowLine left="Direct Debit" right={<span className="text-ok font-semibold">Active</span>} />
          {/* Retention spec §2 — a cancellation runs to the end of the paid month. */}
          {plan.cancelRequestedAt && plan.cancelEffectiveAt && (
            <RowLine
              left="Plan ends"
              right={plan.cancelEffectiveAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}
            />
          )}
          {serviceLine && <RowLine left="Annual service" right={serviceLine} />}
        </Card>
      ) : plan.status === "PAUSED" ? (
        // Retention spec §2 — pause = no collections, no benefits, restarts on its own.
        <Card className="text-center py-5">
          <p className="font-semibold">
            {plan.pausedUntil
              ? `Paused until ${plan.pausedUntil.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" })}`
              : "Your plan is paused"}
          </p>
          <p className="text-xs text-muted mt-1">
            No payments are taken and plan benefits are on hold. It restarts on its own.
          </p>
        </Card>
      ) : plan.status === "CANCELLED" ? (
        <Card className="text-center py-5">
          <p className="font-semibold">This plan is cancelled</p>
          {/* Retention spec §2 — a one-tap Rejoin, not "ask your engineer". */}
          {plan.rejoinToken ? (
            <a href={`/rejoin/${plan.rejoinToken}`} className={`${btnClass()} mt-3 inline-block`}>
              Rejoin {brand}
            </a>
          ) : (
            <p className="text-xs text-muted mt-1">Changed your mind? Ask {brand} to send you a new signup link.</p>
          )}
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
              key={c.code}
              left={
                <>
                  <span className="text-ink font-bold mr-1.5">✓</span>
                  {c.title}
                  {c.note && <span className="block pl-5 text-[11.5px] text-muted">{c.note}</span>}
                </>
              }
              right={
                c.code === "ANNUAL_SERVICE" && serviceLine ? (
                  <span className="text-[11.5px] text-faint">{serviceLine}</span>
                ) : undefined
              }
            />
          ))}
        </Card>
      )}

      {clauses.length > 0 && <NotIncluded />}

      {(plan.status === "ACTIVE" || plan.status === "PAUSED") && (
        <Card>
          <Link href={`/portal/${token}/report`} className="block">
            <RowLine left="Report a problem" right={<Pill tone="info">START</Pill>} />
          </Link>
          <Link href={`/portal/${token}/manage`} className="block">
            <RowLine left="Manage or cancel plan" right={<Pill tone="off">SETTINGS</Pill>} />
          </Link>
        </Card>
      )}

      {/* Section 4 — the home's service history, kept even after a plan ends. */}
      {plan.passport && (
        <Card>
          <Link href={`/passport/${plan.passport.viewToken}`} className="block">
            <RowLine left="Your Home Passport" right={<Pill tone="info">VIEW</Pill>} />
          </Link>
        </Card>
      )}

      <p className="text-xs text-muted text-center">
        Your engineer: {engineerLine}
      </p>
    </CustomerShell>
  );
}
