import Link from "next/link";
import { requireEngineer } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dueServices, type DueService } from "@/lib/reminders";
import { AppShell } from "@/components/shells";
import { Card, Micro, Pill, btnClass } from "@/components/ui";

function JobRow({ d, urgent }: { d: DueService; urgent: boolean }) {
  return (
    <div className="flex justify-between items-center gap-2 py-2.5 border-b border-line-soft last:border-b-0">
      <div>
        <b className="text-sm">{d.customerName}</b>
        <br />
        <Micro>
          {d.onPlan ? `ANNUAL SERVICE · ${d.tierName?.toUpperCase()} PLAN` : "ANNUAL SERVICE · NO PLAN"}
          {d.hasCp12 && " · CP12"}
          {" · "}
          {d.dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }).toUpperCase()}
        </Micro>
      </div>
      {urgent ? (
        <Pill tone="warn">URGENT</Pill>
      ) : d.onPlan ? (
        <Pill tone="info">BOOK</Pill>
      ) : (
        <Pill tone="off">NO PLAN</Pill>
      )}
    </div>
  );
}

// Month grid with a flame dot on days that have jobs.
function CalendarCard({ month, jobs }: { month: Date; jobs: DueService[] }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadBlanks = (first.getDay() + 6) % 7; // Monday-first
  const jobDays = new Set(
    jobs
      .filter(
        (j) =>
          j.dueDate.getMonth() === month.getMonth() &&
          j.dueDate.getFullYear() === month.getFullYear(),
      )
      .map((j) => j.dueDate.getDate()),
  );
  const today = new Date();
  const isThisMonth =
    today.getMonth() === month.getMonth() && today.getFullYear() === month.getFullYear();

  return (
    <Card>
      <h2 className="text-sm font-semibold mb-2">
        {month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
      </h2>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="font-mono text-[10px] text-faint py-1">
            {d}
          </span>
        ))}
        {Array.from({ length: leadBlanks }).map((_, i) => (
          <span key={`b${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const hasJob = jobDays.has(day);
          const isToday = isThisMonth && today.getDate() === day;
          return (
            <span
              key={day}
              className={`relative text-xs py-1.5 rounded-lg ${
                isToday ? "bg-flame text-white font-semibold" : hasJob ? "bg-flame-tint text-flame-deep font-semibold" : "text-ink"
              }`}
            >
              {day}
              {hasJob && !isToday && (
                <span className="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full bg-flame" />
              )}
            </span>
          );
        })}
      </div>
    </Card>
  );
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string; past?: string }>;
}) {
  const engineer = await requireEngineer();
  const { all, past } = await searchParams;
  const due = await dueServices(engineer.id);

  const now = new Date();
  const upcoming = due.filter((d) => d.dueDate >= now);
  const overdue = due.filter((d) => d.dueDate < now);
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 30);

  // Calendar shows the current month, or the month of the next job if the
  // current month is empty.
  const hasJobThisMonth = upcoming.some(
    (d) => d.dueDate.getMonth() === now.getMonth() && d.dueDate.getFullYear() === now.getFullYear(),
  );
  const calendarMonth = hasJobThisMonth || upcoming.length === 0 ? now : upcoming[0].dueDate;

  // Past jobs = completed services on record (import history + plan records).
  const pastAppliances = await prisma.appliance.findMany({
    where: {
      lastServicedAt: { not: null, lt: now },
      property: { customer: { engineerId: engineer.id } },
    },
    include: { property: { include: { customer: true } } },
    orderBy: { lastServicedAt: "desc" },
  });

  const nextJobs = all ? upcoming : upcoming.slice(0, 3);
  const pastJobs = past ? pastAppliances : pastAppliances.slice(0, 3);

  return (
    <AppShell active="JOBS" topRight={<Micro>Jobs</Micro>}>
      <CalendarCard month={calendarMonth} jobs={upcoming} />

      {overdue.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold mb-1">Overdue</h2>
          {overdue.map((d, i) => (
            <JobRow key={i} d={d} urgent />
          ))}
        </Card>
      )}

      <Card>
        <div className="flex justify-between items-baseline mb-1">
          <h2 className="text-sm font-semibold">Next jobs</h2>
          {!all && upcoming.length > 3 && (
            <Link href="/jobs?all=1" className="text-flame-deep text-xs font-semibold">
              View all {upcoming.length} →
            </Link>
          )}
        </div>
        {nextJobs.length === 0 ? (
          <p className="text-xs text-muted py-1">
            Nothing coming up — jobs appear here from plan signups and the last-service column of
            your customer import.
          </p>
        ) : (
          nextJobs.map((d, i) => <JobRow key={i} d={d} urgent={d.hasCp12 && d.dueDate <= soon} />)
        )}
      </Card>

      <Card>
        <div className="flex justify-between items-baseline mb-1">
          <h2 className="text-sm font-semibold">Past jobs</h2>
          {!past && pastAppliances.length > 3 && (
            <Link href="/jobs?past=1" className="text-flame-deep text-xs font-semibold">
              View all {pastAppliances.length} →
            </Link>
          )}
        </div>
        {pastJobs.length === 0 ? (
          <p className="text-xs text-muted py-1">No completed services on record yet.</p>
        ) : (
          pastJobs.map((a) => (
            <div
              key={a.id}
              className="flex justify-between items-center gap-2 py-2.5 border-b border-line-soft last:border-b-0"
            >
              <div>
                <b className="text-sm">
                  {a.property.customer.firstName} {a.property.customer.lastName}
                </b>
                <br />
                <Micro>
                  {`${a.make ?? ""} ${a.model ?? ""}`.trim().toUpperCase() || "BOILER"} · SERVICED{" "}
                  {a.lastServicedAt!.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}
                </Micro>
              </div>
              <Pill tone="ok">DONE</Pill>
            </div>
          ))
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold mb-1">Reminder engine</h2>
        <div className="flex justify-between items-center py-2.5 border-b border-line-soft text-sm">
          <span>Customer reminders</span>
          <Pill tone="ok">AUTO · SMS · 30/14/3 DAYS</Pill>
        </div>
        <div className="flex justify-between items-center py-2.5 text-sm">
          <span>Booking</span>
          <span className="text-xs text-muted">Customer replies to book</span>
        </div>
      </Card>

      <Link href="/doorstep" className={btnClass("copper")}>
        Offer a plan to a no-plan customer
      </Link>
    </AppShell>
  );
}
