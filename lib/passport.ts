// Section 4 — Home Passport. One per address, not per person: a full service
// history that stays with the home when it sells. Several engineers can hold
// plans at the same address; each sees only their own records, the homeowner
// sees everything.
//
// LIVE  = at least one active plan: new records can be added.
// FROZEN = no active plan: past records stay viewable and downloadable,
//          nothing new is added, nothing is ever deleted.
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { checkEmergency } from "@/lib/compliance/interlock";

export type PassportState = "LIVE" | "FROZEN";

// ---------- pure rules (tested in tests/passport.test.ts) ----------

const STREET_ABBREVIATIONS: Record<string, string> = {
  road: "rd",
  street: "st",
  avenue: "ave",
  lane: "ln",
  drive: "dr",
  close: "cl",
  crescent: "cres",
  court: "ct",
  place: "pl",
  gardens: "gdns",
  terrace: "ter",
  grove: "gr",
  square: "sq",
};

export function normalisePostcode(postcode: string): string {
  return postcode.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Loose UK postcode check, used to skip placeholder addresses ("—"). */
export function isUkPostcode(postcode: string): boolean {
  return /^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$/.test(normalisePostcode(postcode));
}

/**
 * Normalised postcode + first line — how a second plan at the same address
 * finds the same passport. "Flat 2, 12 Oak Road" / "flat 2 12 oak rd." match.
 */
export function addressKey(a: { addressLine1: string; postcode: string }): string {
  const line = a.addressLine1
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => STREET_ABBREVIATIONS[w] ?? w)
    .join(" ");
  return `${normalisePostcode(a.postcode)}|${line}`;
}

export function computePassportState(
  plans: { status: string; cancelEffectiveAt?: Date | null }[],
  now = new Date(),
): PassportState {
  const live = plans.some(
    (p) =>
      (p.status === "ACTIVE" || p.status === "PAUSED") &&
      (!p.cancelEffectiveAt || p.cancelEffectiveAt.getTime() > now.getTime()),
  );
  return live ? "LIVE" : "FROZEN";
}

export const REPLACEMENT_LEAD_YEARS = 12;

export function boilerAgeYears(installedAt: Date, now = new Date()): number {
  let years = now.getFullYear() - installedAt.getFullYear();
  const before =
    now.getMonth() < installedAt.getMonth() ||
    (now.getMonth() === installedAt.getMonth() && now.getDate() < installedAt.getDate());
  if (before) years--;
  return Math.max(0, years);
}

// Words in an engineer's note that point at repair work. Gas-safety words
// ("gas leak", "fumes", "CO alarm"…) are never leads — they belong to the
// emergency interlock, so a note that trips it yields no lead at all.
const REPAIR_WORDS: { re: RegExp; label: string }[] = [
  { re: /\bnois(y|e|ier)\b/i, label: "noisy" },
  { re: /\bleak(s|ing|y)?\b/i, label: "leak" },
  { re: /\bdrip(s|ping)?\b/i, label: "dripping" },
  { re: /\bcorro(ded|sion)\b/i, label: "corrosion" },
  { re: /\brust(y|ed|ing)?\b/i, label: "rust" },
  { re: /\bkettling\b/i, label: "kettling" },
  { re: /\bbang(s|ing)?\b/i, label: "banging" },
  { re: /\b(losing|low|dropping)\s+pressure\b/i, label: "losing pressure" },
  { re: /\b(fault|error)\s+code\b/i, label: "fault code" },
  { re: /\bworn\b/i, label: "worn part" },
  { re: /\bseiz(ed|ing)\b/i, label: "seized part" },
  { re: /\bneeds?\s+(replacing|replacement)\b/i, label: "needs replacing" },
];

/** The repair hint in an engineer note, or null (including when it's a gas-safety note). */
export function repairLeadKeyword(notes: string | null | undefined): string | null {
  if (!notes) return null;
  if (checkEmergency(notes).emergency) return null;
  for (const w of REPAIR_WORDS) if (w.re.test(notes)) return w.label;
  return null;
}

export type PassportLead = { kind: "replacement" | "repair"; text: string };

/** Leads for one engineer, only ever with the homeowner's contact consent. */
export function passportLeads(input: {
  contactConsentAt: Date | null;
  boilerInstalledAt: Date | null;
  ownNotes: (string | null)[];
  now?: Date;
}): PassportLead[] {
  if (!input.contactConsentAt) return [];
  const leads: PassportLead[] = [];
  if (input.boilerInstalledAt) {
    const age = boilerAgeYears(input.boilerInstalledAt, input.now);
    if (age >= REPLACEMENT_LEAD_YEARS) {
      leads.push({
        kind: "replacement",
        text: `Boiler is ${age} years old — a good time to talk about a replacement or a heat pump.`,
      });
    }
  }
  for (const n of input.ownNotes) {
    const word = repairLeadKeyword(n);
    if (word) {
      leads.push({ kind: "repair", text: `Your note mentions "${word}" — offer to quote for the repair.` });
      break;
    }
  }
  return leads;
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + months);
  return out;
}

// ---------- data ----------

export async function passportForAddress(a: { addressLine1: string; town?: string | null; postcode: string }) {
  const key = addressKey(a);
  return prisma.homePassport.upsert({
    where: { addressKey: key },
    update: {},
    create: {
      addressKey: key,
      addressLine1: a.addressLine1.trim(),
      town: a.town?.trim() || null,
      postcode: a.postcode.trim().toUpperCase(),
      viewToken: crypto.randomBytes(16).toString("base64url"),
    },
  });
}

export async function passportState(passportId: string, now = new Date()): Promise<PassportState> {
  const plans = await prisma.plan.findMany({
    where: { passportId },
    select: { status: true, cancelEffectiveAt: true },
  });
  return computePassportState(plans, now);
}

/**
 * Links a customer's first property (and its appliances) to the home's
 * passport, creating the passport if this is the first plan at the address.
 * Null when the property has no real address yet.
 */
export async function passportForCustomer(customerId: string): Promise<string | null> {
  const property = await prisma.property.findFirst({
    where: { customerId },
    orderBy: { id: "asc" },
    select: { id: true, passportId: true, addressLine1: true, town: true, postcode: true },
  });
  if (!property) return null;
  if (property.passportId) return property.passportId;
  if (!isUkPostcode(property.postcode) || property.addressLine1.trim().length < 2) return null;
  const passport = await passportForAddress(property);
  await prisma.property.update({ where: { id: property.id }, data: { passportId: passport.id } });
  await prisma.appliance.updateMany({
    where: { propertyId: property.id, passportId: null },
    data: { passportId: passport.id },
  });
  return passport.id;
}

/** On plan activation: tie the plan (and its home) to the passport. Never throws. */
export async function attachPlanToPassport(planId: string): Promise<void> {
  try {
    const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { customerId: true, passportId: true } });
    if (!plan || plan.passportId) return;
    const passportId = await passportForCustomer(plan.customerId);
    if (passportId) await prisma.plan.update({ where: { id: planId }, data: { passportId } });
  } catch (err) {
    console.error("[passport] attach on activation failed:", err);
  }
}

/** The boiler on a passport (first appliance; boiler-type preferred). */
export async function passportBoiler(passportId: string) {
  const appliances = await prisma.appliance.findMany({ where: { passportId }, orderBy: { id: "asc" } });
  return appliances.find((a) => !a.type || /boiler/i.test(a.type)) ?? appliances[0] ?? null;
}

export const RECORD_KIND_LABEL: Record<string, string> = {
  service: "Service",
  certificate: "Certificate",
  install: "Install certificate",
  note: "Engineer note",
};

type Brandable = { id: string; slug: string; tradingName: string | null; legalName: string | null };

/**
 * Everything on a passport, for the homeowner (every engineer's records).
 * `lead` is the engineer whose brand the page wears: the newest live plan's,
 * else the newest plan's.
 */
export async function loadPassportView(where: { viewToken: string } | { id: string }) {
  const passport = await prisma.homePassport.findUnique({
    where,
    include: {
      plans: {
        where: { status: { not: "PENDING" } },
        orderBy: { createdAt: "desc" },
        select: { status: true, cancelEffectiveAt: true, engineer: { select: { id: true, slug: true, tradingName: true, legalName: true } } },
      },
      records: {
        orderBy: { doneAt: "desc" },
        include: { engineer: { select: { id: true, slug: true, tradingName: true, legalName: true } } },
      },
    },
  });
  if (!passport) return null;
  const now = new Date();
  const state = computePassportState(passport.plans, now);
  const livePlans = passport.plans.filter((p) => computePassportState([p], now) === "LIVE");
  const lookedAfterBy: Brandable[] = [];
  for (const p of livePlans) if (!lookedAfterBy.some((e) => e.id === p.engineer.id)) lookedAfterBy.push(p.engineer);
  const lead: Brandable | null = livePlans[0]?.engineer ?? passport.plans[0]?.engineer ?? passport.records[0]?.engineer ?? null;
  const boiler = await passportBoiler(passport.id);
  const lastService = passport.records.find((r) => r.kind === "service") ?? null;
  const nextDueAt =
    state === "LIVE"
      ? (passport.records.find((r) => r.nextDueAt)?.nextDueAt ??
        (boiler?.lastServicedAt ? addMonths(boiler.lastServicedAt, 12) : null))
      : null;
  return { passport, state, lookedAfterBy, lead, boiler, lastService, nextDueAt };
}
