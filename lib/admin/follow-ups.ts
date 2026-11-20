import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { adminEvent } from "@/lib/admin-api/audit";
import { AdminApiError, conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { maskPhone } from "@/lib/admin/mask";
import { displayName } from "@/lib/engineer";
import { personName } from "@/lib/admin/verifications";
import { stripeStages } from "@/lib/admin/stripe-account";
import { CALL_LADDER, daysBetween, ladderStep, lastDeliveredOffers, realEngineerWhere, testMarks } from "@/lib/admin/metrics";
import { followUpsSent } from "@/lib/follow-ups";
import { addDays, ukDay } from "@/lib/admin/time";
import { notSignedUpWhere, SECOND_LETTER_DAYS } from "@/lib/admin/letters";
import { isSuppressed } from "@/lib/suppression";
import { startTpsScreen, tpsStates, tpsSummary, type TpsState } from "@/lib/admin/tps";

const CALL_STEP = CALL_LADDER[CALL_LADDER.length - 1];
const forbidden = (message: string) => new AdminApiError(403, "FORBIDDEN", message);
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

export type FollowUpTab = "calls" | "stripe" | "letters";
export type FollowUpQuery = { tab: FollowUpTab; q?: string; page: number; size: number };

async function claimCalls(codes: string[]) {
  const calls = new Map<string, { at: string; by: string | null; note: string | null }>();
  if (!codes.length) return calls;
  const events = await prisma.event.findMany({
    where: { name: "claim_called", OR: codes.map((code) => ({ meta: { path: ["code"], equals: code } })) },
    orderBy: { ts: "desc" },
    select: { ts: true, meta: true },
  });
  for (const ev of events) {
    const m = ev.meta as { code: string; adminName?: string; note?: string };
    if (!calls.has(m.code)) calls.set(m.code, { at: ev.ts.toISOString(), by: m.adminName ?? null, note: m.note ?? null });
  }
  return calls;
}

async function letterRows(now: Date) {
  const batches = await prisma.letterBatch.findMany({ select: { name: true, postedOn: true } });
  const today = ukDay(now);
  const posted = new Map(batches.map((b) => [b.name, b.postedOn.toISOString().slice(0, 10)]));
  const rows = await prisma.claimCode.findMany({
    where: { ...notSignedUpWhere(), mobile: { not: null } },
    orderBy: [{ claimedAt: "asc" }, { code: "asc" }],
    select: { code: true, firstName: true, businessName: true, town: true, tradingTown: true, letterBatch: true, createdAt: true, claimedAt: true, mobile: true, textConsentAt: true, reminderTextedAt: true },
  });
  return rows.filter((r) => addDays(posted.get(r.letterBatch) ?? ukDay(r.createdAt), SECOND_LETTER_DAYS) <= today);
}

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

const NOT_SCREENED: TpsState = { status: "not_screened", screenedAt: null };

export async function callListPhones(opts: { letters: boolean }, now = new Date()) {
  const marks = await testMarks();
  const [calls, stripe, letters] = await Promise.all([callRows(marks, now), stripeRows(marks), opts.letters ? letterRows(now) : Promise.resolve([])]);
  return [...calls.due.map((x) => x.e.phone), ...stripe.map((e) => e.phone), ...letters.map((r) => r.mobile)].filter((p): p is string => !!p);
}

export async function startCallListScreen(admin: AdminPrincipal, now = new Date()) {
  return startTpsScreen(admin, await callListPhones({ letters: admin.permissions.includes("letters:read") }, now), now);
}

export async function followUpLists(q: FollowUpQuery, opts: { letters: boolean } = { letters: false }, now = new Date()) {
  const marks = await testMarks();
  const [calls, stripe, letters] = await Promise.all([callRows(marks, now), stripeRows(marks), opts.letters ? letterRows(now) : Promise.resolve(null)]);
  const counts = { calls: calls.due.length, stripe: stripe.length, letters: letters ? letters.length : null };
  const phones = [...calls.due.map((x) => x.e.phone), ...stripe.map((e) => e.phone), ...(letters ?? []).map((r) => r.mobile)].filter((p): p is string => !!p);
  const tps = await tpsSummary(phones, now);
  const search = q.q?.trim() ?? "";
  const skip = (q.page - 1) * q.size;
  const tpsOf = async (pagePhones: (string | null)[]) => {
    const states = await tpsStates(pagePhones.filter((p): p is string => !!p), now);
    return (p: string | null) => (p ? (states.get(p) ?? NOT_SCREENED) : null);
  };
  if (q.tab === "letters") {
    if (!letters) throw forbidden("Letters aren't part of your role.");
    const needle = search.toLowerCase();
    const all = needle ? letters.filter((r) => [r.businessName, r.firstName, r.code, r.tradingTown ?? "", r.town ?? ""].some((v) => v.toLowerCase().includes(needle))) : letters;
    const pageRows = all.slice(skip, skip + q.size);
    const [called, tpsFor, optedOut] = await Promise.all([
      claimCalls(pageRows.map((r) => r.code)),
      tpsOf(pageRows.map((r) => r.mobile)),
      Promise.all(pageRows.map((r) => isSuppressed("sms", r.mobile!))),
    ]);
    return {
      tab: q.tab,
      items: pageRows.map((r, i) => ({
        code: r.code,
        business: r.businessName,
        owner: r.firstName,
        town: r.tradingTown?.trim() || r.town,
        batch: r.letterBatch,
        claimedAt: r.claimedAt!.toISOString(),
        phone: maskPhone(r.mobile!),
        textConsent: Boolean(r.textConsentAt),
        remindedAt: r.reminderTextedAt?.toISOString() ?? null,
        optedOut: optedOut[i]!,
        lastCall: called.get(r.code) ?? null,
        tps: tpsFor(r.mobile)!,
      })),
      page: q.page,
      size: q.size,
      total: all.length,
      counts,
      tps,
    };
  }
  if (q.tab === "calls") {
    const all = search ? calls.due.filter((x) => matches(x.e, search)) : calls.due;
    const pageRows = all.slice(skip, skip + q.size);
    const [called, sent, tpsFor] = await Promise.all([lastCalls(pageRows.map((x) => x.e.id)), Promise.all(pageRows.map((x) => followUpsSent(x.e.id))), tpsOf(pageRows.map((x) => x.e.phone))]);
    return {
      tab: q.tab,
      items: pageRows.map((x, i) => ({
        ...person(x.e),
        days: x.days,
        countingFrom: calls.lastOffer.has(x.e.id) ? ("last_offer" as const) : ("live" as const),
        lastDeliveredOfferAt: calls.lastOffer.get(x.e.id)?.toISOString() ?? null,
        sent: sent[i]!.filter((s) => s.from === x.from.toISOString()).map(({ step, channel, label, at, went }) => ({ step, channel, label, at, went })),
        lastCall: called.get(x.e.id) ?? null,
        tps: tpsFor(x.e.phone),
      })),
      page: q.page,
      size: q.size,
      total: all.length,
      counts,
      tps,
    };
  }
  const all = search ? stripe.filter((e) => matches(e, search)) : stripe;
  const pageRows = all.slice(skip, skip + q.size);
  const [called, tpsFor] = await Promise.all([lastCalls(pageRows.map((e) => e.id)), tpsOf(pageRows.map((e) => e.phone))]);
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
        tps: tpsFor(e.phone),
      };
    }),
    page: q.page,
    size: q.size,
    total: all.length,
    counts,
    tps,
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
