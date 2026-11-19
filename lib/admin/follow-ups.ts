import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { adminEvent } from "@/lib/admin-api/audit";
import { conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { maskPhone } from "@/lib/admin/mask";
import { displayName } from "@/lib/engineer";
import { personName } from "@/lib/admin/verifications";
import { stripeStages } from "@/lib/admin/stripe-account";
import { CALL_LADDER, daysBetween, ladderStep, lastDeliveredOffers, realEngineerWhere, testMarks } from "@/lib/admin/metrics";
import { followUpsSent } from "@/lib/follow-ups";

const CALL_STEP = CALL_LADDER[CALL_LADDER.length - 1];
export const STRIPE_DEADLINE_SOON_DAYS = 7;

const standing = { ownerId: null, bannedAt: null, pausedAt: null, leftAt: null } satisfies Prisma.EngineerWhereInput;
const SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  tradingName: true,
  legalName: true,
  slug: true,
  town: true,
  phone: true,
  gasSafeVerifiedAt: true,
  stripeAccountId: true,
  stripeDetailsSubmitted: true,
  stripeChargesEnabled: true,
  stripePayoutsEnabled: true,
  stripeOnboardingStartedAt: true,
  stripeRequirementsDeadline: true,
  _count: { select: { plans: { where: { status: "ACTIVE" } } } },
} satisfies Prisma.EngineerSelect;
type Row = Prisma.EngineerGetPayload<{ select: typeof SELECT }>;

export type FollowUpTab = "calls" | "stripe";
export type FollowUpQuery = { tab: FollowUpTab; q?: string; page: number; size: number };

async function lastCalls(ids: string[]) {
  const calls = new Map<string, { at: string; by: string | null; note: string | null }>();
  if (!ids.length) return calls;
  const events = await prisma.event.findMany({
    where: { name: "engineer_called", OR: ids.map((id) => ({ meta: { path: ["engineerId"], equals: id } })) },
    orderBy: { ts: "desc" },
    select: { ts: true, meta: true },
  });
  for (const ev of events) {
    const m = ev.meta as { engineerId: string; adminName?: string; note?: string };
    if (!calls.has(m.engineerId)) calls.set(m.engineerId, { at: ev.ts.toISOString(), by: m.adminName ?? null, note: m.note ?? null });
  }
  return calls;
}

const matches = (r: Row, q: string) => {
  const needle = q.toLowerCase();
  return [displayName(r), personName(r), r.town ?? ""].some((s) => s.toLowerCase().includes(needle));
};

function person(r: Row) {
  return { id: r.id, business: displayName(r), owner: personName(r), town: r.town, phone: r.phone ? maskPhone(r.phone) : null, customersOnPlan: r._count.plans };
}

async function callRows(marks: Awaited<ReturnType<typeof testMarks>>, now: Date) {
  const live = await prisma.engineer.findMany({ where: { ...realEngineerWhere(marks), ...standing, gasSafeVerifiedAt: { not: null }, gasSafeCardReadId: { not: null } }, select: SELECT });
  const lastOffer = await lastDeliveredOffers(marks, live.map((e) => e.id));
  const due = live
    .map((e) => {
      const from = lastOffer.get(e.id) ?? e.gasSafeVerifiedAt!;
      return { e, from, days: daysBetween(from, now) };
    })
    .filter((x) => (ladderStep(x.days)?.step ?? 0) >= CALL_STEP.step)
    .sort((a, b) => b.days - a.days || displayName(a.e).localeCompare(displayName(b.e)));
  return { due, lastOffer };
}

async function stripeRows(marks: Awaited<ReturnType<typeof testMarks>>) {
  const rows = await prisma.engineer.findMany({
    where: { ...realEngineerWhere(marks), ...standing, stripeAccountId: { not: null }, stripePayoutsEnabled: false },
    select: SELECT,
  });
  return rows
    .filter((e) => stripeStages(e).stage2 === "due")
    .sort((a, b) => (a.stripeRequirementsDeadline?.getTime() ?? Infinity) - (b.stripeRequirementsDeadline?.getTime() ?? Infinity) || displayName(a).localeCompare(displayName(b)));
}

export async function followUpLists(q: FollowUpQuery, now = new Date()) {
  const marks = await testMarks();
  const [calls, stripe] = await Promise.all([callRows(marks, now), stripeRows(marks)]);
  const counts = { calls: calls.due.length, stripe: stripe.length };
  const search = q.q?.trim() ?? "";
  const skip = (q.page - 1) * q.size;
  if (q.tab === "calls") {
    const all = search ? calls.due.filter((x) => matches(x.e, search)) : calls.due;
    const pageRows = all.slice(skip, skip + q.size);
    const [called, sent] = await Promise.all([lastCalls(pageRows.map((x) => x.e.id)), Promise.all(pageRows.map((x) => followUpsSent(x.e.id)))]);
    return {
      tab: q.tab,
      items: pageRows.map((x, i) => ({
        ...person(x.e),
        days: x.days,
        countingFrom: calls.lastOffer.has(x.e.id) ? ("last_offer" as const) : ("live" as const),
        lastDeliveredOfferAt: calls.lastOffer.get(x.e.id)?.toISOString() ?? null,
        sent: sent[i]!.filter((s) => s.from === x.from.toISOString()).map(({ step, channel, label, at, went }) => ({ step, channel, label, at, went })),
        lastCall: called.get(x.e.id) ?? null,
      })),
      page: q.page,
      size: q.size,
      total: all.length,
      counts,
    };
  }
  const all = search ? stripe.filter((e) => matches(e, search)) : stripe;
  const pageRows = all.slice(skip, skip + q.size);
  const called = await lastCalls(pageRows.map((e) => e.id));
  return {
    tab: q.tab,
    items: pageRows.map((e) => {
      const deadline = e.stripeRequirementsDeadline;
      const daysLeft = deadline ? daysBetween(now, deadline) : null;
      return {
        ...person(e),
        stripe: stripeStages(e),
        chargesEnabled: e.stripeChargesEnabled,
        deadline: deadline?.toISOString() ?? null,
        daysLeft,
        urgent: daysLeft !== null && daysLeft <= STRIPE_DEADLINE_SOON_DAYS,
        lastCall: called.get(e.id) ?? null,
      };
    }),
    page: q.page,
    size: q.size,
    total: all.length,
    counts,
  };
}

export async function logCall(admin: AdminPrincipal, engineerId: string, note: string) {
  const e = await prisma.engineer.findFirst({ where: { id: engineerId, deletedAt: null }, select: { ownerId: true } });
  if (!e) throw notFound("There's no engineer with that ID.");
  if (e.ownerId) throw conflict("Calls are logged against the business, not a member of staff.");
  const at = new Date();
  await adminEvent(admin, "engineer_called", { engineerId, note });
  return { at: at.toISOString(), by: admin.name };
}

export async function withFollowUpHistory<T extends { lastDeliveredOfferAt: string | null; countingFrom: "last_offer" | "live" } | null>(engineerId: string, chase: T) {
  const [sent, calls] = await Promise.all([followUpsSent(engineerId), lastCalls([engineerId])]);
  const lastCall = calls.get(engineerId) ?? null;
  if (!chase) return { chase: null, lastCall };
  const spell = sent.filter((s) => chase.lastDeliveredOfferAt === null || s.from === chase.lastDeliveredOfferAt);
  return { chase: { ...chase, sent: spell.map(({ step, channel, label, at, went }) => ({ step, channel, label, at, went })) }, lastCall };
}
