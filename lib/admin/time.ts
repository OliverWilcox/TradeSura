// UK calendar days for admin reporting, whatever the server's own clock is
// set to. A "day" is a YYYY-MM-DD string in Europe/London; weeks start Monday.

const ukParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parts(d: Date) {
  const p = Object.fromEntries(ukParts.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: p.hour, minute: p.minute };
}

/** The UK calendar day an instant falls on. */
export function ukDay(d: Date): string {
  return parts(d).day;
}

/** The instant a UK calendar day starts (00:00 London, which is 23:00 UTC the day before in summer). */
export function ukMidnight(day: string): Date {
  for (const offsetHours of [0, 1]) {
    const candidate = new Date(Date.parse(`${day}T00:00:00Z`) - offsetHours * 3_600_000);
    const p = parts(candidate);
    if (p.day === day && p.hour === "00" && p.minute === "00") return candidate;
  }
  throw new Error(`Not a calendar day: ${day}`);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a day. */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

export function daysBetween(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  for (let d = fromDay; d < toDay; d = addDays(d, 1)) out.push(d);
  return out;
}
