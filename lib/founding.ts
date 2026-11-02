// 30 Oct update §10 — Founding Members and the top 3 spots per town.
//
// Founding badge: everyone who claims by their letter date. Permanent.
// Top 3 spots: the first 3 Founding Members in a town to complete their
// account (Gas Safe check done, a live plan, payments on). A spot is released
// if they haven't signed a customer within 60 days of getting it (reminders
// at 30, 14, 7 and 2 days left); they keep the badge and the spot passes to
// the next Founding Member in that town to complete.
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";
import { EMAIL, emailButton, emailShell, escapeHtml } from "@/lib/email-layout";
import { notifyEngineer } from "@/lib/sms";
import { sendPushNotification } from "@/lib/push";
import { track } from "@/lib/track";

const DAY = 24 * 60 * 60 * 1000;
export const TOP_SPOTS_PER_TOWN = 3;
export const TOP_SPOT_DAYS = 60;
export const TOP_SPOT_REMINDER_DAYS = [30, 14, 7, 2] as const;
// Without an admin-set letter date, a batch's Founding window is this long
// from when its codes were loaded.
export const DEFAULT_FOUNDING_WINDOW_DAYS = 28;

// ---------- the letter date ----------

/** AppSetting key holding a letter batch's Founding deadline, "YYYY-MM-DD". */
export const foundingDeadlineKey = (letterBatch: string) => `founding_deadline:${letterBatch}`;

/** End of the given UK day (23:59:59 London) as an instant. */
function endOfUkDay(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const noon = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(noon.getTime())) return null;
  // London is UTC or UTC+1; 23:59:59 local is 22:59:59 or 23:59:59 UTC.
  const offsetHours = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(noon),
  ) - 12;
  return new Date(Date.parse(`${isoDate}T23:59:59Z`) - offsetHours * 60 * 60 * 1000);
}

export function foundingDeadlineFrom(setting: string | null | undefined, codesLoadedAt: Date): Date {
  return (setting && endOfUkDay(setting.trim())) || new Date(codesLoadedAt.getTime() + DEFAULT_FOUNDING_WINDOW_DAYS * DAY);
}

export async function foundingDeadline(code: { letterBatch: string; createdAt: Date }): Promise<Date> {
  const row = await prisma.appSetting.findUnique({ where: { key: foundingDeadlineKey(code.letterBatch) } }).catch(() => null);
  return foundingDeadlineFrom(row?.value, code.createdAt);
}

/** Claimed (the claim page) or, failing that, redeemed at sign-up, by the letter date. */
export function claimedInTime(code: { claimedAt: Date | null; redeemedAt: Date | null }, deadline: Date): boolean {
  const at = code.claimedAt ?? code.redeemedAt;
  return Boolean(at && at <= deadline);
}

/** Which of these engineers are Founding Members. */
export async function foundingMemberIds(engineerIds: string[]): Promise<Set<string>> {
  if (engineerIds.length === 0) return new Set();
  const codes = await prisma.claimCode.findMany({
    where: { redeemedByEngineerId: { in: engineerIds }, suppressedAt: null },
    select: { redeemedByEngineerId: true, claimedAt: true, redeemedAt: true, letterBatch: true, createdAt: true },
  });
  const out = new Set<string>();
  for (const c of codes) {
    if (claimedInTime(c, await foundingDeadline(c))) out.add(c.redeemedByEngineerId!);
  }
  return out;
}

export async function isFoundingMember(engineerId: string): Promise<boolean> {
  return (await foundingMemberIds([engineerId])).has(engineerId);
}

// ---------- completing the account ----------

export type CompletionFacts = {
  gasSafeVerifiedAt: Date | null;
  stripeChargesEnabled: boolean;
  liveTiers: number;
  pausedAt: Date | null;
  bannedAt: Date | null;
  deletedAt: Date | null;
  leftAt: Date | null;
  ownerId: string | null;
};

/** Customers can join: the badge, a live plan and payments on (the offer lock open). */
export function accountComplete(e: CompletionFacts): boolean {
  return (
    Boolean(e.gasSafeVerifiedAt) &&
    e.stripeChargesEnabled &&
    e.liveTiers > 0 &&
    !e.pausedAt &&
    !e.bannedAt &&
    !e.deletedAt &&
    !e.leftAt &&
    !e.ownerId
  );
}

const COMPLETION_SELECT = {
  id: true,
  townSlug: true,
  accountCompletedAt: true,
  gasSafeVerifiedAt: true,
  stripeChargesEnabled: true,
  pausedAt: true,
  bannedAt: true,
  deletedAt: true,
  leftAt: true,
  ownerId: true,
  _count: { select: { tiers: { where: { status: "LIVE" as const } } } },
} as const;

/**
 * Records the first moment the account could take sign-ups, then hands out
 * any free top spot in their town. Safe to call any time, as often as you
 * like: it only ever sets the time once.
 */
export async function markAccountComplete(engineerId: string, now = new Date()): Promise<boolean> {
  const e = await prisma.engineer.findUnique({ where: { id: engineerId }, select: COMPLETION_SELECT });
  if (!e || e.accountCompletedAt) return false;
  if (!accountComplete({ ...e, liveTiers: e._count.tiers })) return false;
  const { count } = await prisma.engineer.updateMany({
    where: { id: engineerId, accountCompletedAt: null },
    data: { accountCompletedAt: now },
  });
  if (count && e.townSlug) await syncTownSpots(e.townSlug, now);
  return count > 0;
}

// ---------- the top 3 ----------

export type Holder = {
  spotId: string;
  engineerId: string;
  heldFrom: Date;
  /** Signed at least one customer (a plan that went through sign-up). */
  hasCustomer: boolean;
  /** Still a complete account in this town. */
  stillHere: boolean;
};

export type Candidate = { engineerId: string; completedAt: Date };

export type SpotPlan = {
  release: { spotId: string; engineerId: string; reason: "no_customer" | "left_town" }[];
  award: string[];
};

export function spotEndsAt(heldFrom: Date): Date {
  return new Date(heldFrom.getTime() + TOP_SPOT_DAYS * DAY);
}

/**
 * Pure: who loses a spot, who gets one. Candidates are complete Founding
 * Members in the town with no spot and none released before; first to
 * complete gets the next free spot.
 */
export function planTownSpots(holders: Holder[], candidates: Candidate[], now: Date): SpotPlan {
  const release: SpotPlan["release"] = [];
  for (const h of holders) {
    if (!h.stillHere) release.push({ spotId: h.spotId, engineerId: h.engineerId, reason: "left_town" });
    else if (!h.hasCustomer && now >= spotEndsAt(h.heldFrom)) {
      release.push({ spotId: h.spotId, engineerId: h.engineerId, reason: "no_customer" });
    }
  }
  const kept = holders.length - release.length;
  const free = Math.max(0, TOP_SPOTS_PER_TOWN - kept);
  const award = [...candidates]
    .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime() || a.engineerId.localeCompare(b.engineerId))
    .slice(0, free)
    .map((c) => c.engineerId);
  return { release, award };
}

/** Days left on a spot, rounded up; 0 once it's due to go. */
export function daysLeft(heldFrom: Date, now: Date): number {
  return Math.max(0, Math.ceil((spotEndsAt(heldFrom).getTime() - now.getTime()) / DAY));
}

/** The reminder due now (30, 14, 7 or 2 days left), if any: the tightest one already reached. */
export function reminderDue(heldFrom: Date, now: Date): number | null {
  const left = daysLeft(heldFrom, now);
  if (left <= 0) return null;
  const reached = TOP_SPOT_REMINDER_DAYS.filter((d) => left <= d);
  return reached.length ? Math.min(...reached) : null;
}

async function signedACustomer(engineerId: string): Promise<boolean> {
  return (await prisma.plan.count({ where: { engineerId, activatedAt: { not: null } } })) > 0;
}

export async function openSpots(townSlug: string) {
  return prisma.topSpot.findMany({ where: { townSlug, releasedAt: null }, orderBy: { heldFrom: "asc" } });
}

/** Releases and hands out spots for one town. Idempotent. */
export async function syncTownSpots(townSlug: string, now = new Date()): Promise<SpotPlan> {
  const spots = await openSpots(townSlug);
  const holders: Holder[] = await Promise.all(
    spots.map(async (s) => {
      const e = await prisma.engineer.findUnique({ where: { id: s.engineerId }, select: COMPLETION_SELECT });
      const stillHere = Boolean(e && e.townSlug === townSlug && !e.deletedAt && !e.bannedAt && !e.leftAt);
      return { spotId: s.id, engineerId: s.engineerId, heldFrom: s.heldFrom, hasCustomer: await signedACustomer(s.engineerId), stillHere };
    }),
  );

  const everHeld = new Set(
    (await prisma.topSpot.findMany({ where: { townSlug }, select: { engineerId: true } })).map((s) => s.engineerId),
  );
  const complete = await prisma.engineer.findMany({
    where: { townSlug, accountCompletedAt: { not: null }, deletedAt: null, bannedAt: null, leftAt: null, ownerId: null },
    select: { id: true, accountCompletedAt: true },
  });
  const founding = await foundingMemberIds(complete.map((e) => e.id).filter((id) => !everHeld.has(id)));
  const candidates = complete
    .filter((e) => founding.has(e.id))
    .map((e) => ({ engineerId: e.id, completedAt: e.accountCompletedAt! }));

  const plan = planTownSpots(holders, candidates, now);
  const town = await townLabel(townSlug);
  for (const r of plan.release) {
    const { count } = await prisma.topSpot.updateMany({
      where: { id: r.spotId, releasedAt: null },
      data: { releasedAt: now, releaseReason: r.reason },
    });
    if (!count) continue;
    await track("top_spot_released", { type: "SYSTEM" }, { engineerId: r.engineerId, townSlug, reason: r.reason });
    if (r.reason === "no_customer") await tellReleased(r.engineerId, town);
  }
  for (const engineerId of plan.award) {
    // One open spot per engineer, whatever races with this.
    if (await prisma.topSpot.findFirst({ where: { engineerId, releasedAt: null } })) continue;
    const spot = await prisma.topSpot.create({ data: { townSlug, engineerId, heldFrom: now } });
    await track("top_spot_awarded", { type: "SYSTEM" }, { engineerId, townSlug, spotId: spot.id });
    await tellAwarded(engineerId, town, spotEndsAt(now));
  }
  return plan;
}

export async function spotsLeft(townSlug: string | null | undefined): Promise<number> {
  if (!townSlug) return TOP_SPOTS_PER_TOWN;
  const held = await prisma.topSpot.count({ where: { townSlug, releasedAt: null } });
  return Math.max(0, TOP_SPOTS_PER_TOWN - held);
}

/** Engineers holding a top spot, keyed to when they got it. */
export async function topSpotHolders(townSlug: string): Promise<Map<string, Date>> {
  return new Map((await openSpots(townSlug)).map((s) => [s.engineerId, s.heldFrom]));
}

async function townLabel(townSlug: string): Promise<string> {
  const page = await prisma.townPage.findUnique({ where: { slug: townSlug }, select: { name: true } });
  return page?.name ?? townSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- telling the engineer ----------

export const longUkDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

function founderEmail(title: string, paragraphs: string[], button: { href: string; label: string }) {
  const rows = `
  <tr><td style="padding:28px 32px 6px;">
    <div style="font-size:22px;line-height:28px;font-weight:700;color:${EMAIL.ink};padding-bottom:14px;">${escapeHtml(title)}</div>
    ${paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${EMAIL.body};">${escapeHtml(p)}</p>`).join("")}
  </td></tr>
  <tr><td style="padding:6px 32px 26px;">${emailButton(button.href, button.label)}</td></tr>`;
  return emailShell({ title, preheader: paragraphs[0] ?? title, rows });
}

async function emailTo(engineerId: string) {
  return prisma.engineer.findUnique({ where: { id: engineerId }, select: { email: true, deletedAt: true } });
}

async function tellAwarded(engineerId: string, town: string, endsAt: Date) {
  const line = `You've got a top spot in ${town}: your business now sits at the top of the ${town} page. Sign your first customer by ${longUkDate(endsAt)} to keep it.`;
  await sendPushNotification(engineerId, `Top spot in ${town}`, line, { url: "/" }).catch(() => {});
  await notifyEngineer(engineerId, `TradeSura: ${line}`, { template: "top_spot_awarded", vars: [town, longUkDate(endsAt)] }).catch(() => {});
  const e = await emailTo(engineerId);
  if (e && !e.deletedAt) {
    await sendEmail({
      to: e.email,
      subject: `You've got a top spot in ${town}`,
      html: founderEmail(`You've got a top spot in ${town}`, [line, "Your Founding Member badge is yours to keep, whatever happens."], {
        href: `${appUrl()}/api/open?to=customers`,
        label: "Open TradeSura",
      }),
    }).catch((err) => console.error("[founding] awarded email failed:", err));
  }
}

async function tellReleased(engineerId: string, town: string) {
  const line = `Your top spot in ${town} has passed to the next Founding Member, as no customer joined within ${TOP_SPOT_DAYS} days. You keep your Founding Member badge.`;
  await sendPushNotification(engineerId, `Top spot in ${town}`, line, { url: "/" }).catch(() => {});
  await notifyEngineer(engineerId, `TradeSura: ${line}`, { template: "top_spot_released", vars: [town] }).catch(() => {});
}

async function sendReminder(spot: { id: string; engineerId: string; heldFrom: Date }, town: string, days: number) {
  const by = longUkDate(spotEndsAt(spot.heldFrom));
  const line = `${days} days left to keep your top spot in ${town}: sign your first customer by ${by}.`;
  await sendPushNotification(spot.engineerId, `${days} days left on your top spot`, line, { url: "/" }).catch(() => {});
  await notifyEngineer(spot.engineerId, `TradeSura: ${line}`, {
    template: "top_spot_reminder",
    vars: [String(days), town, by],
  }).catch(() => {});
  const e = await emailTo(spot.engineerId);
  if (e && !e.deletedAt) {
    await sendEmail({
      to: e.email,
      subject: `${days} days left to keep your top spot in ${town}`,
      html: founderEmail(`${days} days left on your top spot`, [line, "The quickest way: offer a plan at your next job, or send your plans to your last 10 customers."], {
        href: `${appUrl()}/api/open?to=customers`,
        label: "Open TradeSura",
      }),
    }).catch((err) => console.error("[founding] reminder email failed:", err));
  }
}

// ---------- the daily job ----------

/**
 * Daily: catch accounts that completed without passing a hook (e.g. a Gas
 * Safe approval in the admin app), release and hand out spots in every town
 * that has some, and send the 30/14/7/2-day reminders once each.
 */
export async function runFoundingJobs(now = new Date()) {
  const unmarked = await prisma.engineer.findMany({
    where: {
      accountCompletedAt: null,
      gasSafeVerifiedAt: { not: null },
      stripeChargesEnabled: true,
      tiers: { some: { status: "LIVE" } },
      ownerId: null,
      deletedAt: null,
    },
    select: { id: true },
  });
  let completed = 0;
  for (const e of unmarked) if (await markAccountComplete(e.id, now)) completed += 1;

  const towns = new Set<string>();
  for (const s of await prisma.topSpot.findMany({ where: { releasedAt: null }, select: { townSlug: true } })) towns.add(s.townSlug);
  for (const e of await prisma.engineer.findMany({
    where: { accountCompletedAt: { not: null }, townSlug: { not: null }, deletedAt: null },
    select: { townSlug: true },
    distinct: ["townSlug"],
  })) towns.add(e.townSlug!);

  let released = 0;
  let awarded = 0;
  for (const t of towns) {
    const p = await syncTownSpots(t, now);
    released += p.release.length;
    awarded += p.award.length;
  }

  let reminders = 0;
  for (const spot of await prisma.topSpot.findMany({ where: { releasedAt: null } })) {
    const days = reminderDue(spot.heldFrom, now);
    if (days === null || (await signedACustomer(spot.engineerId))) continue;
    const already = await prisma.event.findFirst({
      where: { name: "top_spot_reminder", AND: [{ meta: { path: ["spotId"], equals: spot.id } }, { meta: { path: ["days"], equals: days } }] },
      select: { id: true },
    });
    if (already) continue;
    // Recorded before sending, so a crash part-way never sends it twice.
    await track("top_spot_reminder", { type: "SYSTEM" }, { spotId: spot.id, engineerId: spot.engineerId, days });
    await sendReminder(spot, await townLabel(spot.townSlug), days);
    reminders += 1;
  }
  return { completed, released, awarded, reminders };
}

// ---------- town page order ----------

export type TownRow = {
  id: string;
  name: string;
  /** When they got their top spot; null if they don't hold one. */
  topSpotFrom: Date | null;
  /** Direct Debit active, not cancelled. Ranking only, never shown. */
  payingCustomers: number;
  ratingCount: number;
  ratingAverage: number | null;
  lastRatedAt: Date | null;
};

function byReviews(a: TownRow, b: TownRow): number {
  return (
    b.ratingCount - a.ratingCount ||
    (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0) ||
    (b.lastRatedAt?.getTime() ?? 0) - (a.lastRatedAt?.getTime() ?? 0)
  );
}

/**
 * (1) Founding top 3, in the order they got their spot › (2) most active
 * locally: paying customers, ties by review score › (3) everyone else by
 * review score (number, average, recency).
 */
export function townPageOrder<T extends TownRow>(rows: T[]): T[] {
  const group = (r: TownRow) => (r.topSpotFrom ? 0 : r.payingCustomers > 0 ? 1 : 2);
  return [...rows].sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    if (group(a) === 0) return a.topSpotFrom!.getTime() - b.topSpotFrom!.getTime();
    if (group(a) === 1) return b.payingCustomers - a.payingCustomers || byReviews(a, b) || a.name.localeCompare(b.name);
    return byReviews(a, b) || a.name.localeCompare(b.name);
  });
}

/** Paying customers (Direct Debit active, not cancelling) and the latest rating, per engineer. */
export async function rankingFacts(engineerIds: string[]): Promise<Map<string, { payingCustomers: number; lastRatedAt: Date | null }>> {
  const out = new Map(engineerIds.map((id) => [id, { payingCustomers: 0, lastRatedAt: null as Date | null }]));
  if (engineerIds.length === 0) return out;
  const [paying, rated] = await Promise.all([
    prisma.plan.groupBy({
      by: ["engineerId"],
      where: { engineerId: { in: engineerIds }, status: "ACTIVE", cancelRequestedAt: null, cancelledAt: null },
      _count: true,
    }),
    prisma.rating.groupBy({
      by: ["engineerId"],
      where: { engineerId: { in: engineerIds }, ratedAt: { not: null }, removedAt: null, stars: { not: null } },
      _max: { ratedAt: true },
    }),
  ]);
  for (const p of paying) out.get(p.engineerId)!.payingCustomers = p._count;
  for (const r of rated) out.get(r.engineerId)!.lastRatedAt = r._max.ratedAt;
  return out;
}

// ---------- the claim page's Founding line ----------

export function foundingCountLine(opts: { town: string; spotsLeft: number; deadline: Date; now: Date }): string {
  if (opts.now > opts.deadline) {
    return `Your Founding reservation ended on ${longUkDate(opts.deadline)}, but your free account is still waiting.`;
  }
  if (opts.spotsLeft <= 0) {
    return `${opts.town}'s top 3 spots have gone, but you can still claim your Founding Member badge until ${longUkDate(opts.deadline)}.`;
  }
  return `Top spots left in ${opts.town}: ${opts.spotsLeft} of ${TOP_SPOTS_PER_TOWN}`;
}
