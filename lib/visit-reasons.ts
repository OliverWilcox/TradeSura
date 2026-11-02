import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

// 30 Oct update §6 — "the app does the selling". The installer picks why
// they were there (one tap, required) and everything the customer then sees
// is tailored to it: headline, their likely worries and our answers, which
// benefits lead, which plan is pre-selected, and the follow-up texts. Matt
// edits all of it in Muhammad's admin (VisitReasonContent rows, split-
// testable by variant) without an app update; with no row for a reason the
// defaults below apply.
//
// Customer-facing text stays inside the plan-wording rules (CLAUDE.md
// compliance 1): maintenance and priority only — tests/visit-reasons.test.ts
// runs every default through lib/compliance/blocklist.ts. The installer's
// button label is the one exception ("Breakdown / repair" is what he did).

export const VISIT_REASONS = ["new_boiler", "breakdown", "yearly_service", "landlord", "other"] as const;
export type VisitReason = (typeof VISIT_REASONS)[number];

export type Preselect = "first" | "middle" | "top" | "landlord";

export type ReasonContent = {
  reason: string;
  variant: string;
  label: string;
  headline: string;
  worries: string[];
  messages: string[];
  graphicKey: string | null;
  /** Clause codes, most relevant first; the rest keep their usual order. */
  benefitOrder: string[];
  preselect: Preselect;
  /** {first} = customer's first name, {engineer} = trading name, {link} = their link. */
  followUp2d: string;
  followUp7d: string;
};

// The warranty and safety lines are Matt's safe wording (30 Oct §7.6,
// short text version): "keeps your boiler safe, efficient and your warranty
// valid".
const DEFAULTS: Record<VisitReason, Omit<ReasonContent, "reason" | "variant">> = {
  new_boiler: {
    label: "New boiler fitted",
    headline: "Keep your new boiler's warranty valid",
    worries: [
      "Will I remember the yearly service?",
      "What if the warranty won't pay out?",
    ],
    messages: [
      "Most manufacturers require a yearly service to keep your warranty valid. Your plan books it in for you.",
      "Your service history is kept on your Home Passport, so the proof is always there.",
      "Spread the cost monthly by Direct Debit. Cancel any time, no contract.",
    ],
    graphicKey: "new-boiler",
    benefitOrder: ["ANNUAL_SERVICE", "WARRANTY_VALID", "SERVICE_HISTORY", "ANNUAL_REMINDER", "WARRANTY_ADMIN"],
    preselect: "middle",
    followUp2d:
      "Hi {first}, {engineer} here. Thanks for having me fit your new boiler. A yearly service keeps it safe, efficient and your warranty valid, and my plan books it in for you: {link}",
    followUp7d:
      "Hi {first}, {engineer} again. Your new boiler's warranty usually needs a yearly service. My plan takes care of it for a small monthly amount: {link}",
  },
  breakdown: {
    label: "Breakdown / repair",
    headline: "Glad it's sorted. Let's keep it that way",
    worries: [
      "Will it happen again?",
      "Who do I call next time, and how long will I wait?",
    ],
    messages: [
      "A yearly service catches small problems early, before they turn into costly repairs.",
      "Plan members get priority booking: you're first in my diary.",
      "No call-out or attendance fees on your plan, so you can ring without worrying about the bill to turn up.",
    ],
    graphicKey: "repair",
    benefitOrder: ["PRIORITY_48H", "SAMEDAY_PRIORITY", "NO_CALLOUT_FEE", "DIRECT_LINE", "LABOUR_DISCOUNT_15", "ANNUAL_SERVICE"],
    preselect: "top",
    followUp2d:
      "Hi {first}, {engineer} here. Hope the boiler's behaving since my visit. Plan members get priority booking and a yearly service to catch problems early: {link}",
    followUp7d:
      "Hi {first}, {engineer} again. If you'd like to be first in my diary next time, my care plan is here: {link}",
  },
  yearly_service: {
    label: "Yearly service",
    headline: "Never think about your boiler service again",
    worries: [
      "I always forget to book the service.",
      "Paying for it all in one go hurts.",
    ],
    messages: [
      "Your plan books your yearly service in, so it never gets missed.",
      "Spread the cost monthly by Direct Debit, at a price fixed for 12 months.",
      "A yearly service keeps your boiler safe, efficient and your warranty valid.",
    ],
    graphicKey: "service",
    benefitOrder: ["ANNUAL_SERVICE", "ANNUAL_REMINDER", "PRIORITY_48H", "NO_CALLOUT_FEE"],
    preselect: "middle",
    followUp2d:
      "Hi {first}, {engineer} here. Thanks for having me round for your service. Next year's can be booked in automatically, paid monthly: {link}",
    followUp7d:
      "Hi {first}, {engineer} again. Never miss a boiler service: my plan books it in and spreads the cost monthly: {link}",
  },
  landlord: {
    label: "Landlord safety check",
    headline: "Your gas safety record, sorted every year",
    worries: [
      "What if the gas safety record runs out?",
      "Arranging access with tenants is a pain.",
    ],
    messages: [
      "Your landlord plan includes the yearly gas safety record (CP12), booked in before it's due.",
      "Records are kept on the Home Passport, ready when you need them.",
      "One monthly Direct Debit per property. Cancel any time, no contract.",
    ],
    graphicKey: "landlord",
    benefitOrder: ["CP12", "SMOKE_CO_CHECKS", "TENANT_LIAISON", "CERT_STORAGE", "ANNUAL_SERVICE", "PRIORITY_48H"],
    preselect: "landlord",
    followUp2d:
      "Hi {first}, {engineer} here. Thanks for having me do the gas safety check. My landlord plan books next year's CP12 in for you, paid monthly: {link}",
    followUp7d:
      "Hi {first}, {engineer} again. Never chase a gas safety record again: my landlord plan is here: {link}",
  },
  other: {
    label: "Other work",
    headline: "Keep your boiler looked after, all year",
    worries: ["When was my boiler last serviced?"],
    messages: [
      "A yearly service keeps your boiler safe, efficient and your warranty valid.",
      "Plan members get priority booking with an engineer they already know.",
      "Spread the cost monthly by Direct Debit. Cancel any time, no contract.",
    ],
    graphicKey: "general",
    benefitOrder: ["ANNUAL_SERVICE", "PRIORITY_48H", "NO_CALLOUT_FEE"],
    preselect: "middle",
    followUp2d:
      "Hi {first}, {engineer} here. Thanks for having me round. My care plan keeps your boiler safe, efficient and your warranty valid: {link}",
    followUp7d: "Hi {first}, {engineer} again. My care plan is still here if you'd like it: {link}",
  },
};

export function isVisitReason(v: unknown): v is VisitReason {
  return typeof v === "string" && (VISIT_REASONS as readonly string[]).includes(v);
}

export function defaultContent(reason: VisitReason): ReasonContent {
  return { reason, variant: "A", ...DEFAULTS[reason] };
}

type Row = {
  reason: string;
  variant: string;
  weight: number;
  label: string;
  sortOrder: number;
  headline: string;
  worries: unknown;
  messages: unknown;
  graphicKey: string | null;
  benefitOrder: unknown;
  preselect: string;
  followUp2d: string;
  followUp7d: string;
};

const strings = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback;

function fromRow(r: Row): ReasonContent {
  const base = isVisitReason(r.reason) ? DEFAULTS[r.reason] : DEFAULTS.other;
  return {
    reason: r.reason,
    variant: r.variant,
    label: r.label || base.label,
    headline: r.headline || base.headline,
    worries: strings(r.worries, base.worries),
    messages: strings(r.messages, base.messages),
    graphicKey: r.graphicKey,
    benefitOrder: strings(r.benefitOrder, base.benefitOrder),
    preselect: (["first", "middle", "top", "landlord"] as const).includes(r.preselect as Preselect)
      ? (r.preselect as Preselect)
      : base.preselect,
    followUp2d: r.followUp2d || base.followUp2d,
    followUp7d: r.followUp7d || base.followUp7d,
  };
}

/**
 * Weighted, deterministic pick between split-test variants: the same seed
 * (an offer's token) always lands on the same variant, so the customer page,
 * the follow-up texts and the conversion report all agree.
 */
export function pickVariant<T extends { variant: string; weight: number }>(rows: T[], seed: string): T | null {
  const live = rows.filter((r) => r.weight > 0).sort((a, b) => a.variant.localeCompare(b.variant));
  if (live.length === 0) return null;
  const total = live.reduce((n, r) => n + r.weight, 0);
  let point = createHash("sha256").update(seed).digest().readUInt32BE(0) % total;
  for (const r of live) {
    if (point < r.weight) return r;
    point -= r.weight;
  }
  return live[live.length - 1];
}

/** The installer's one-tap list: admin rows (active, by sortOrder) over the defaults. */
export async function reasonList(): Promise<{ reason: string; label: string }[]> {
  const rows = await prisma.visitReasonContent
    .findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { variant: "asc" }] })
    .catch(() => []);
  const fromAdmin = new Map<string, string>();
  for (const r of rows) if (!fromAdmin.has(r.reason)) fromAdmin.set(r.reason, r.label);
  const list: { reason: string; label: string }[] = VISIT_REASONS.map((reason) => ({
    reason,
    label: fromAdmin.get(reason) ?? DEFAULTS[reason].label,
  }));
  // A reason the admin added that we don't ship a default for.
  for (const [reason, label] of fromAdmin) if (!isVisitReason(reason)) list.push({ reason, label });
  return list;
}

/** The content for one reason, picking the split-test variant for this seed. */
export async function reasonContent(reason: string, seed: string): Promise<ReasonContent> {
  const rows = await prisma.visitReasonContent.findMany({ where: { reason, active: true } }).catch(() => []);
  const row = pickVariant(rows, seed);
  if (row) return fromRow(row);
  return defaultContent(isVisitReason(reason) ? reason : "other");
}

/** Fills {first}, {engineer} and {link} in a follow-up text. */
export function fillFollowUp(text: string, v: { first: string; engineer: string; link: string }): string {
  const out = text.replace(/\{first\}/g, v.first).replace(/\{engineer\}/g, v.engineer).replace(/\{link\}/g, v.link);
  // The link is the point of the text: never send one without it.
  return out.includes(v.link) ? out : `${out} ${v.link}`;
}

/**
 * The plan the reason pre-selects among the engineer's live plans (in their
 * usual order): the cheapest, the middle one, the top one, or the first
 * landlord plan (falling back to the middle).
 */
export function preselectedTierId(
  tiers: { id: string; landlord: boolean }[],
  preselect: Preselect,
): string | undefined {
  if (tiers.length === 0) return undefined;
  if (preselect === "landlord") {
    const l = tiers.find((t) => t.landlord);
    if (l) return l.id;
  }
  const homeowner = tiers.filter((t) => !t.landlord);
  const pool = homeowner.length ? homeowner : tiers;
  if (preselect === "first") return pool[0].id;
  if (preselect === "top") return pool[pool.length - 1].id;
  return pool[Math.floor((pool.length - 1) / 2)].id;
}

/** Benefit lines reordered so the reason's most relevant come first. */
export function orderBenefits<T extends { code: string }>(lines: T[], benefitOrder: string[]): T[] {
  const rank = (code: string) => {
    const i = benefitOrder.indexOf(code);
    return i === -1 ? benefitOrder.length : i;
  };
  return lines
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l.code) - rank(b.l.code) || a.i - b.i)
    .map((x) => x.l);
}
