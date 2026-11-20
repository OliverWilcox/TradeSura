import { prisma } from "@/lib/db";
import { adminEvent } from "@/lib/admin-api/audit";
import { AdminApiError, conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { normaliseUkPhone } from "@/lib/phone";

export const TPS_VALID_DAYS = 28;
export const TPS_MAX_NUMBERS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TpsStatus = "clear" | "registered" | "waiting" | "not_screened";
export type TpsState = { status: TpsStatus; screenedAt: string | null };
export type TpsSummary = { due: number; waiting: { id: string; createdAt: string; numbers: number } | null; lastAnsweredAt: string | null; validDays: number };

export const nationalNumber = (e164: string) => (e164.startsWith("+44") ? `0${e164.slice(3)}` : e164);

export function screenedNumber(raw: string): string | null {
  const digits = raw.replace(/[\s\-().'"]/g, "");
  return normaliseUkPhone(digits) ?? (/^[1-9]\d{9}$/.test(digits) ? normaliseUkPhone(`0${digits}`) : null);
}

export async function tpsStates(phones: string[], now = new Date()): Promise<Map<string, TpsState>> {
  const wanted = [...new Set(phones.filter(Boolean))];
  const out = new Map<string, TpsState>(wanted.map((p) => [p, { status: "not_screened", screenedAt: null }]));
  if (!wanted.length) return out;
  const screens = await prisma.tpsScreen.findMany({
    where: { numbers: { hasSome: wanted }, OR: [{ answeredAt: null }, { answeredAt: { gte: new Date(now.getTime() - TPS_VALID_DAYS * DAY_MS) } }] },
    orderBy: [{ answeredAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: { numbers: true, registered: true, answeredAt: true },
  });
  const decided = new Set<string>();
  for (const s of screens) {
    const registered = new Set(s.registered);
    for (const phone of s.numbers) {
      if (!out.has(phone) || decided.has(phone)) continue;
      if (s.answeredAt) {
        out.set(phone, { status: registered.has(phone) ? "registered" : "clear", screenedAt: s.answeredAt.toISOString() });
        decided.add(phone);
      } else if (out.get(phone)!.status === "not_screened") {
        out.set(phone, { status: "waiting", screenedAt: null });
      }
    }
  }
  return out;
}

export async function tpsSummary(phones: string[], now = new Date()): Promise<TpsSummary> {
  const [states, waiting, last] = await Promise.all([
    tpsStates(phones, now),
    prisma.tpsScreen.findFirst({ where: { answeredAt: null }, orderBy: { createdAt: "desc" }, select: { id: true, createdAt: true, numbers: true } }),
    prisma.tpsScreen.findFirst({ where: { answeredAt: { not: null } }, orderBy: { answeredAt: "desc" }, select: { answeredAt: true } }),
  ]);
  return {
    due: [...states.values()].filter((s) => s.status === "not_screened" || s.status === "waiting").length,
    waiting: waiting ? { id: waiting.id, createdAt: waiting.createdAt.toISOString(), numbers: waiting.numbers.length } : null,
    lastAnsweredAt: last?.answeredAt?.toISOString() ?? null,
    validDays: TPS_VALID_DAYS,
  };
}

export async function startTpsScreen(admin: AdminPrincipal, phones: string[], now = new Date()) {
  const states = await tpsStates(phones, now);
  const numbers = [...states].filter(([, s]) => s.status === "not_screened" || s.status === "waiting").map(([p]) => p).sort();
  if (!numbers.length) throw conflict(`Every number on the call lists was screened in the last ${TPS_VALID_DAYS} days.`);
  const screen = await prisma.$transaction(async (tx) => {
    await tx.tpsScreen.deleteMany({ where: { answeredAt: null } });
    const created = await tx.tpsScreen.create({ data: { numbers, createdById: admin.id, createdBy: admin.name }, select: { id: true, createdAt: true } });
    await adminEvent(admin, "tps_screen_started", { screenId: created.id, numbers: numbers.length }, tx);
    return created;
  });
  return { id: screen.id, createdAt: screen.createdAt.toISOString(), numbers: numbers.map(nationalNumber) };
}

export async function answerTpsScreen(admin: AdminPrincipal, id: string, input: { listed: "registered" | "clear"; numbers: string[] }, now = new Date()) {
  const screen = await prisma.tpsScreen.findUnique({ where: { id }, select: { id: true, numbers: true, answeredAt: true } });
  if (!screen) throw notFound("That screening isn't waiting any more. Download the numbers to screen again.");
  if (screen.answeredAt) throw conflict("That screening has already been answered.");
  if (input.numbers.length > TPS_MAX_NUMBERS) throw new AdminApiError(400, "VALIDATION", `Send at most ${TPS_MAX_NUMBERS.toLocaleString("en-GB")} numbers.`, { numbers: ["Too many numbers."] });
  const sent = new Set(screen.numbers);
  const given = new Set<string>();
  let ignored = 0;
  for (const raw of input.numbers) {
    const phone = screenedNumber(raw);
    if (phone && sent.has(phone)) given.add(phone);
    else ignored++;
  }
  const registered = input.listed === "registered" ? [...given] : screen.numbers.filter((p) => !given.has(p));
  await prisma.$transaction(async (tx) => {
    const done = await tx.tpsScreen.updateMany({ where: { id, answeredAt: null }, data: { answeredAt: now, answeredBy: admin.name, registered } });
    if (!done.count) throw conflict("That screening has already been answered.");
    await adminEvent(admin, "tps_screen_answered", { screenId: id, listed: input.listed, registered: registered.length, clear: screen.numbers.length - registered.length, ignored }, tx);
  });
  return { registered: registered.length, clear: screen.numbers.length - registered.length, ignored, screenedAt: now.toISOString() };
}
