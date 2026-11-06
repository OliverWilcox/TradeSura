import { prisma } from "@/lib/db";
import { computeApplicationFeePence } from "@/lib/stripe";
import { sendPushNotification } from "@/lib/push";

// Matt, 6 Nov — the four Grow cards: Pick your first 10, First month goal,
// the 60-second how-to video and staff commission. The money and pace maths
// is plain functions so it's tested on its own.

export const FIRST_TEN = 10;
export const FIRST_TEN_SOURCE = "first10";

const MONTH = 30 * 24 * 3600_000;

export type FirstTenCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  hints: ("landlord" | "recent" | "regular")[];
  offered: boolean;
};

/** Who can be picked, and why they're likely to join; landlords and recent work first. */
export function firstTenCandidates(
  customers: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    smsOptOut: boolean;
    plans: { status: string; offerSource: string | null }[];
    properties: { appliances: { lastServicedAt: Date | null; installedAt: Date | null }[] }[];
  }[],
  now: Date,
): FirstTenCandidate[] {
  return customers
    .filter((c) => /^\+447\d{9}$/.test(c.phone) && !c.smsOptOut)
    .filter((c) => !c.plans.some((p) => p.status === "ACTIVE" || p.status === "PAUSED"))
    .map((c) => {
      const appliances = c.properties.flatMap((p) => p.appliances);
      const recentCutoff = now.getTime() - 18 * MONTH;
      const hints: FirstTenCandidate["hints"] = [];
      if (c.properties.length > 1) hints.push("landlord");
      if (appliances.some((a) => (a.installedAt && a.installedAt.getTime() > recentCutoff) || (a.lastServicedAt && a.lastServicedAt.getTime() > recentCutoff))) hints.push("recent");
      if (appliances.some((a) => a.lastServicedAt)) hints.push("regular");
      return { id: c.id, firstName: c.firstName, lastName: c.lastName, phone: c.phone, hints, offered: c.plans.some((p) => p.offerSource === FIRST_TEN_SOURCE) };
    })
    .sort((a, b) => b.hints.length - a.hints.length || a.firstName.localeCompare(b.firstName));
}


/** The engineer's monthly take from a plan: the price less our 20%, rounded down in their favour. */
export function engineerKeepsPence(pricePence: number): number {
  return pricePence - computeApplicationFeePence(pricePence);
}

/** The calendar month in London: its first instant (as UTC), the day we're on and how many days it has. */
export function londonMonth(now: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<"year" | "month" | "day" | "hour", number>;
  const daysInMonth = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  // Midnight London on the 1st: UTC midnight less London's offset that day
  // (an hour in summer). The 1st is never a clock-change day.
  const utcMidnight = Date.UTC(p.year, p.month - 1, 1);
  const londonHourAtUtcMidnight = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hourCycle: "h23" }).format(new Date(utcMidnight)),
  );
  return { start: new Date(utcMidnight - londonHourAtUtcMidnight * 3600_000), day: p.day, daysInMonth };
}

/**
 * Where a goal should be by today: the target spread evenly over the month.
 * Behind once they're under that pace, but not in the first week, when one
 * plan either way says nothing.
 */
export function goalPace(target: number, signed: number, day: number, daysInMonth: number) {
  const pace = (target * day) / daysInMonth;
  return { pace, behind: target > 0 && day > 7 && signed < Math.floor(pace) && signed < target };
}

export type CommissionRule = { type: "signup" | "monthly"; pence: number };
type SoldPlan = { activatedAt: Date | null; cancelledAt: Date | null };

/** Calendar months a plan has been live in, counting the month it started and the current one. */
function monthsLive(p: SoldPlan, now: Date): number {
  if (!p.activatedAt) return 0;
  const end = p.cancelledAt && p.cancelledAt < now ? p.cancelledAt : now;
  if (end < p.activatedAt) return 0;
  return (end.getUTCFullYear() - p.activatedAt.getUTCFullYear()) * 12 + (end.getUTCMonth() - p.activatedAt.getUTCMonth()) + 1;
}

/**
 * What a staff member has earned under the owner's rule: per sign-up (each
 * plan that went live), or per month each plan is live. "This month" counts
 * sign-ups since the 1st, or plans live at some point this month.
 */
export function commissionFor(rule: CommissionRule | null, plans: SoldPlan[], monthStart: Date, now: Date) {
  const live = plans.filter((p) => p.activatedAt);
  if (!rule) return { thisMonthPence: 0, toDatePence: 0 };
  if (rule.type === "signup") {
    return {
      thisMonthPence: live.filter((p) => p.activatedAt! >= monthStart).length * rule.pence,
      toDatePence: live.length * rule.pence,
    };
  }
  const liveThisMonth = live.filter((p) => !(p.cancelledAt && p.cancelledAt < monthStart));
  return {
    thisMonthPence: liveThisMonth.length * rule.pence,
    toDatePence: live.reduce((sum, p) => sum + monthsLive(p, now) * rule.pence, 0),
  };
}

export function commissionRuleOf(e: { staffCommissionType: string | null; staffCommissionPence: number | null }): CommissionRule | null {
  if ((e.staffCommissionType !== "signup" && e.staffCommissionType !== "monthly") || !e.staffCommissionPence) return null;
  return { type: e.staffCommissionType, pence: e.staffCommissionPence };
}

/** The how-to video's address: an env var until there's an admin setting for it. Null until Matt's video exists. */
export function howToVideoUrl(): string | null {
  return process.env.HOWTO_VIDEO_URL?.trim() || null;
}

/** Everything the four Grow cards show, for /api/me (owners only). */
export async function growSummary(engineerId: string, now = new Date()) {
  const month = londonMonth(now);
  const [engineer, firstTen, signedThisMonth, staffCount] = await Promise.all([
    prisma.engineer.findUniqueOrThrow({
      where: { id: engineerId },
      select: { monthlyGoal: true, howToVideoWatchedAt: true, staffCommissionType: true, staffCommissionPence: true },
    }),
    prisma.plan.findMany({ where: { engineerId, offerSource: FIRST_TEN_SOURCE }, distinct: ["customerId"], select: { customerId: true } }),
    prisma.plan.findMany({ where: { engineerId, activatedAt: { gte: month.start } }, select: { priceMonthlyPence: true } }),
    prisma.engineer.count({ where: { ownerId: engineerId, deletedAt: null, staffRemovedAt: null } }),
  ]);
  const signed = signedThisMonth.length;
  const target = engineer.monthlyGoal ?? 0;
  return {
    firstTenSent: Math.min(firstTen.length, FIRST_TEN),
    goal: {
      target: engineer.monthlyGoal,
      signed,
      worthPence: signedThisMonth.reduce((sum, p) => sum + engineerKeepsPence(p.priceMonthlyPence ?? 0), 0),
      ...goalPace(target, signed, month.day, month.daysInMonth),
    },
    howToVideo: { url: howToVideoUrl(), watchedAt: engineer.howToVideoWatchedAt },
    staff: { count: staffCount, commission: commissionRuleOf(engineer) },
  };
}

/**
 * Daily job: a push to owners who are behind their goal, at most once a
 * week. Never a text — it's a nudge about their own numbers.
 */
export async function nudgeBehindGoals(now = new Date()) {
  const month = londonMonth(now);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const owners = await prisma.engineer.findMany({
    where: {
      monthlyGoal: { gt: 0 },
      ownerId: null,
      deletedAt: null,
      OR: [{ goalNudgedAt: null }, { goalNudgedAt: { lt: weekAgo } }],
    },
    select: { id: true, monthlyGoal: true },
  });
  let sent = 0;
  for (const o of owners) {
    const signed = await prisma.plan.count({ where: { engineerId: o.id, activatedAt: { gte: month.start } } });
    const { behind, pace } = goalPace(o.monthlyGoal!, signed, month.day, month.daysInMonth);
    if (!behind) continue;
    const short = Math.ceil(pace) - signed;
    await sendPushNotification(
      o.id,
      "Your first month goal",
      `${signed} of ${o.monthlyGoal} plans so far. ${short} more this week puts you back on track. Offer one at the end of your next job.`,
      { href: "/grow/goal" },
    ).catch(() => {});
    await prisma.engineer.update({ where: { id: o.id }, data: { goalNudgedAt: now } });
    sent++;
  }
  return sent;
}
