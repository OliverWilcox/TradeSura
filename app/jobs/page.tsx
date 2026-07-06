import Link from "next/link";
import { requireEngineer } from "@/lib/auth";
import { dueServices } from "@/lib/reminders";
import { AppShell } from "@/components/shells";
import { Card, Micro, Pill, btnClass } from "@/components/ui";

function monthKey(d: Date) {
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default async function JobsPage() {
  const engineer = await requireEngineer();
  const due = await dueServices(engineer.id);

  const now = new Date();
  const horizon = new Date(now);
  horizon.setMonth(horizon.getMonth() + 12);
  const upcoming = due.filter((d) => d.dueDate <= horizon);

  const groups = new Map<string, typeof upcoming>();
  for (const d of upcoming) {
    const key = d.dueDate < now ? "Overdue" : monthKey(d.dueDate);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const soon = new Date(now);
  soon.setDate(soon.getDate() + 30);

  return (
    <AppShell active="JOBS" topRight={<Micro>Jobs</Micro>}>
      {upcoming.length === 0 ? (
        <Card className="text-center py-8">
          <p className="font-semibold">No services due yet</p>
          <p className="text-xs text-muted mt-1.5">
            Service dates come from plan signups and the last-service column of
            your customer import.
          </p>
        </Card>
      ) : (
        [...groups.entries()].map(([month, items]) => (
          <Card key={month}>
            <h2 className="text-sm font-semibold mb-1">
              {month === "Overdue" ? "Overdue" : `Services due — ${month}`}
            </h2>
            {items.map((d, i) => (
              <div
                key={`${d.customerId}-${i}`}
                className="flex justify-between items-center gap-2 py-2 border-b border-line-soft last:border-b-0"
              >
                <div>
                  <b className="text-sm">{d.customerName}</b>
                  <br />
                  <Micro>
                    {d.onPlan ? `ANNUAL SERVICE · ${d.tierName?.toUpperCase()} PLAN` : "ANNUAL SERVICE · NO PLAN"}
                    {d.hasCp12 && " · CP12"}
                    {" · DUE "}
                    {d.dueDate
                      .toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
                      .toUpperCase()}
                  </Micro>
                </div>
                {month === "Overdue" || (d.hasCp12 && d.dueDate <= soon) ? (
                  <Pill tone="warn">URGENT</Pill>
                ) : d.onPlan ? (
                  <Pill tone="info">BOOK</Pill>
                ) : (
                  <Pill tone="off">NO PLAN</Pill>
                )}
              </div>
            ))}
          </Card>
        ))
      )}

      <Card>
        <h2 className="text-sm font-semibold mb-1">Reminder engine</h2>
        <div className="flex justify-between items-center py-2 border-b border-line-soft text-sm">
          <span>Customer reminders</span>
          <Pill tone="ok">AUTO · SMS · 30/14/3 DAYS</Pill>
        </div>
        <div className="flex justify-between items-center py-2 text-sm">
          <span>Booking</span>
          <span className="text-xs text-muted">Customer replies to book</span>
        </div>
      </Card>

      <Card className="bg-flame-tint border-[#BBDCF4]">
        <p className="text-xs text-flame-deep">
          <b>Why this matters:</b> a serviced plan customer renews. A forgotten one cancels. This
          screen is your churn defence.
        </p>
      </Card>

      <Link href="/doorstep" className={btnClass("copper")}>
        Offer a plan to a no-plan customer
      </Link>
    </AppShell>
  );
}
