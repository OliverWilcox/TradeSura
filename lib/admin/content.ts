import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { adminEvent } from "@/lib/admin-api/audit";
import { AdminApiError, conflict, notFound } from "@/lib/admin-api/route";
import type { AdminPrincipal } from "@/lib/admin-api/token";
import { CLAUSE_TEMPLATES } from "@/lib/clauses";
import { checkWording } from "@/lib/compliance/blocklist";
import { testMarks } from "@/lib/admin/metrics";
import {
  VISIT_REASONS,
  defaultContent,
  isVisitReason,
  type Preselect,
  type ReasonContent,
} from "@/lib/visit-reasons";

export const PRESELECTS: Preselect[] = ["first", "middle", "top", "landlord"];

export const GRAPHIC_KEYS = ["new-boiler", "repair", "service", "landlord", "general"] as const;

export const CONTENT_LIMITS = {
  label: 40,
  headline: 80,
  line: 200,
  worries: 4,
  messages: 5,
  followUp: 320,
  variants: 6,
  reasons: 12,
};

export const BENEFIT_CODES = CLAUSE_TEMPLATES.map((c) => ({ code: c.code, title: c.title }));
const KNOWN_CODES = new Set(CLAUSE_TEMPLATES.map((c) => c.code));

export type VariantSummary = { variant: string; weight: number; share: number };

export type ReasonSummary = {
  reason: string;
  label: string;
  shipped: boolean;
  active: boolean;
  sortOrder: number;
  edited: boolean;
  variants: VariantSummary[];
  updatedAt: string | null;
};

export type VariantDetail = Omit<ReasonContent, "reason" | "label"> & {
  weight: number;
  share: number;
  saved: boolean;
  updatedAt: string | null;
};

export type ReasonDetail = {
  reason: string;
  label: string;
  shipped: boolean;
  active: boolean;
  variants: VariantDetail[];
  options: { benefits: { code: string; title: string }[]; graphics: string[]; preselects: Preselect[]; limits: typeof CONTENT_LIMITS };
};

type Row = Prisma.VisitReasonContentGetPayload<Record<string, never>>;

const strings = (v: unknown): string[] => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : []);
const shares = (rows: { weight: number }[]) => {
  const total = rows.reduce((n, r) => n + Math.max(0, r.weight), 0);
  return (w: number) => (total > 0 ? Math.round((Math.max(0, w) / total) * 100) : 0);
};
const nextLetter = (variants: string[]) => {
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!variants.includes(letter)) return letter;
  }
  throw conflict("Every variant letter is taken.");
};
const latest = (rows: { updatedAt: Date }[]) => (rows.length ? new Date(Math.max(...rows.map((r) => r.updatedAt.getTime()))).toISOString() : null);

function defaultRow(reason: string, label?: string): Prisma.VisitReasonContentUncheckedCreateInput {
  const d = defaultContent(isVisitReason(reason) ? reason : "other");
  return {
    reason,
    variant: "A",
    weight: 1,
    active: true,
    label: label ?? d.label,
    sortOrder: isVisitReason(reason) ? VISIT_REASONS.indexOf(reason) : VISIT_REASONS.length,
    headline: d.headline,
    worries: d.worries,
    messages: d.messages,
    graphicKey: d.graphicKey,
    benefitOrder: d.benefitOrder,
    preselect: d.preselect,
    followUp2d: d.followUp2d,
    followUp7d: d.followUp7d,
  };
}

function defaultVariant(reason: string): VariantDetail {
  const d = defaultContent(isVisitReason(reason) ? reason : "other");
  return {
    variant: d.variant,
    weight: 1,
    share: 100,
    saved: false,
    updatedAt: null,
    headline: d.headline,
    worries: d.worries,
    messages: d.messages,
    graphicKey: d.graphicKey,
    benefitOrder: d.benefitOrder,
    preselect: d.preselect,
    followUp2d: d.followUp2d,
    followUp7d: d.followUp7d,
  };
}

function reasonRows(rows: Row[]) {
  const byReason = new Map<string, Row[]>();
  for (const r of rows) byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r]);
  for (const list of byReason.values()) list.sort((a, b) => a.variant.localeCompare(b.variant));
  return byReason;
}

function summarise(reason: string, rows: Row[]): ReasonSummary {
  const shipped = isVisitReason(reason);
  if (rows.length === 0) {
    const d = defaultContent(shipped ? reason : "other");
    return { reason, label: d.label, shipped, active: true, sortOrder: VISIT_REASONS.indexOf(reason as (typeof VISIT_REASONS)[number]), edited: false, variants: [{ variant: "A", weight: 1, share: 100 }], updatedAt: null };
  }
  const share = shares(rows);
  return {
    reason,
    label: rows[0].label,
    shipped,
    active: rows.some((r) => r.active),
    sortOrder: rows[0].sortOrder,
    edited: true,
    variants: rows.map((r) => ({ variant: r.variant, weight: r.weight, share: share(r.weight) })),
    updatedAt: latest(rows),
  };
}

export async function listReasons(): Promise<ReasonSummary[]> {
  const byReason = reasonRows(await prisma.visitReasonContent.findMany());
  const keys = [...VISIT_REASONS, ...[...byReason.keys()].filter((k) => !isVisitReason(k))];
  return keys.map((k) => summarise(k, byReason.get(k) ?? [])).sort((a, b) => a.sortOrder - b.sortOrder || a.reason.localeCompare(b.reason));
}

async function rowsOf(reason: string): Promise<Row[]> {
  const rows = await prisma.visitReasonContent.findMany({ where: { reason }, orderBy: { variant: "asc" } });
  if (rows.length === 0 && !isVisitReason(reason)) throw notFound("There's no visit reason with that key.");
  return rows;
}

export async function reasonDetail(reason: string): Promise<ReasonDetail> {
  const rows = await rowsOf(reason);
  const summary = summarise(reason, rows);
  const share = shares(rows);
  const variants: VariantDetail[] = rows.length
    ? rows.map((r) => {
        const d = defaultContent(isVisitReason(reason) ? reason : "other");
        return {
          variant: r.variant,
          weight: r.weight,
          share: share(r.weight),
          saved: true,
          updatedAt: r.updatedAt.toISOString(),
          headline: r.headline || d.headline,
          worries: strings(r.worries),
          messages: strings(r.messages),
          graphicKey: r.graphicKey,
          benefitOrder: strings(r.benefitOrder),
          preselect: PRESELECTS.includes(r.preselect as Preselect) ? (r.preselect as Preselect) : d.preselect,
          followUp2d: r.followUp2d,
          followUp7d: r.followUp7d,
        };
      })
    : [defaultVariant(reason)];
  return {
    reason,
    label: summary.label,
    shipped: summary.shipped,
    active: summary.active,
    variants,
    options: { benefits: BENEFIT_CODES, graphics: [...GRAPHIC_KEYS], preselects: PRESELECTS, limits: CONTENT_LIMITS },
  };
}

async function materialise(reason: string, db: Prisma.TransactionClient): Promise<Row[]> {
  const rows = await db.visitReasonContent.findMany({ where: { reason }, orderBy: { variant: "asc" } });
  if (rows.length) return rows;
  if (!isVisitReason(reason)) throw notFound("There's no visit reason with that key.");
  return [await db.visitReasonContent.create({ data: defaultRow(reason) })];
}

export type VariantInput = {
  label: string;
  headline: string;
  worries: string[];
  messages: string[];
  graphicKey: string | null;
  benefitOrder: string[];
  preselect: Preselect;
  followUp2d: string;
  followUp7d: string;
};

export function checkContentWording(input: VariantInput): void {
  const fields: [string, string[]][] = [
    ["headline", [input.headline]],
    ["worries", input.worries],
    ["messages", input.messages],
    ["followUp2d", [input.followUp2d]],
    ["followUp7d", [input.followUp7d]],
  ];
  for (const [field, lines] of fields) {
    for (const line of lines) {
      const check = checkWording(line);
      if (!check.ok) {
        throw new AdminApiError(400, "VALIDATION", `"${check.phrase}" makes this read as insurance. Plans promise maintenance and priority only (try "${check.suggestion.title}").`, {
          [field]: [`"${check.phrase}" isn't allowed in plan wording.`],
        });
      }
    }
  }
  const unknown = input.benefitOrder.filter((c) => !KNOWN_CODES.has(c));
  if (unknown.length) {
    throw new AdminApiError(400, "VALIDATION", `No benefit has the code ${unknown[0]}.`, { benefitOrder: [`No benefit has the code ${unknown[0]}.`] });
  }
  if (input.graphicKey && !(GRAPHIC_KEYS as readonly string[]).includes(input.graphicKey)) {
    throw new AdminApiError(400, "VALIDATION", "Choose one of the app's graphics.", { graphicKey: ["Choose one of the app's graphics."] });
  }
}

export async function saveVariant(admin: AdminPrincipal, reason: string, variant: string, input: VariantInput): Promise<ReasonDetail> {
  checkContentWording(input);
  await prisma.$transaction(async (db) => {
    const rows = await materialise(reason, db);
    if (!rows.some((r) => r.variant === variant)) throw notFound(`This reason has no variant ${variant}.`);
    const content = {
      headline: input.headline,
      worries: input.worries,
      messages: input.messages,
      graphicKey: input.graphicKey,
      benefitOrder: input.benefitOrder,
      preselect: input.preselect,
      followUp2d: input.followUp2d,
      followUp7d: input.followUp7d,
    };
    await db.visitReasonContent.update({ where: { reason_variant: { reason, variant } }, data: content });
    await db.visitReasonContent.updateMany({ where: { reason }, data: { label: input.label } });
    await adminEvent(admin, "visit_content_changed", { reason, variant, change: "saved", label: input.label }, db);
  });
  return reasonDetail(reason);
}

export async function addVariant(admin: AdminPrincipal, reason: string): Promise<ReasonDetail> {
  await prisma.$transaction(async (db) => {
    const rows = await materialise(reason, db);
    if (rows.length >= CONTENT_LIMITS.variants) throw conflict(`A reason can have up to ${CONTENT_LIMITS.variants} variants.`);
    const variant = nextLetter(rows.map((r) => r.variant));
    const { id: _id, createdAt: _c, updatedAt: _u, ...from } = rows[0];
    void _id;
    void _c;
    void _u;
    await db.visitReasonContent.create({
      data: { ...from, worries: from.worries as Prisma.InputJsonValue, messages: from.messages as Prisma.InputJsonValue, benefitOrder: from.benefitOrder as Prisma.InputJsonValue, variant, weight: 0 },
    });
    await adminEvent(admin, "visit_content_changed", { reason, variant, change: "variant_added" }, db);
  });
  return reasonDetail(reason);
}

export async function deleteVariant(admin: AdminPrincipal, reason: string, variant: string): Promise<ReasonDetail> {
  if (variant === "A") throw conflict("Variant A is the reason's own content and stays.");
  await prisma.$transaction(async (db) => {
    const row = await db.visitReasonContent.findUnique({ where: { reason_variant: { reason, variant } } });
    if (!row) throw notFound(`This reason has no variant ${variant}.`);
    await db.visitReasonContent.delete({ where: { id: row.id } });
    const left = await db.visitReasonContent.findMany({ where: { reason } });
    if (!left.some((r) => r.weight > 0)) await db.visitReasonContent.updateMany({ where: { reason, variant: "A" }, data: { weight: 1 } });
    await adminEvent(admin, "visit_content_changed", { reason, variant, change: "variant_deleted" }, db);
  });
  return reasonDetail(reason);
}

export async function setSplit(admin: AdminPrincipal, reason: string, weights: { variant: string; weight: number }[]): Promise<ReasonDetail> {
  if (!weights.some((w) => w.weight > 0)) throw new AdminApiError(400, "VALIDATION", "Give at least one variant some of the traffic.", { weights: ["Give at least one variant some of the traffic."] });
  await prisma.$transaction(async (db) => {
    const rows = await materialise(reason, db);
    const known = new Set(rows.map((r) => r.variant));
    const missing = weights.find((w) => !known.has(w.variant));
    if (missing) throw notFound(`This reason has no variant ${missing.variant}.`);
    if (weights.length !== rows.length) throw new AdminApiError(400, "VALIDATION", "Set every variant's share.", { weights: ["Set every variant's share."] });
    for (const w of weights) await db.visitReasonContent.update({ where: { reason_variant: { reason, variant: w.variant } }, data: { weight: w.weight } });
    await adminEvent(admin, "visit_content_changed", { reason, change: "split_set", weights }, db);
  });
  return reasonDetail(reason);
}

const KEY = /^[a-z][a-z0-9_]{1,39}$/;

export function reasonKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]/, "r$&")
    .slice(0, 40);
}

export async function addReason(admin: AdminPrincipal, label: string): Promise<ReasonSummary> {
  const reason = reasonKey(label);
  if (!KEY.test(reason)) throw new AdminApiError(400, "VALIDATION", "Give the reason a name with some letters in it.", { label: ["Give the reason a name with some letters in it."] });
  return prisma.$transaction(async (db) => {
    const all = await db.visitReasonContent.findMany();
    const keys = new Set([...VISIT_REASONS, ...all.map((r) => r.reason)]);
    if (keys.has(reason)) throw conflict("There's already a reason with that name.");
    if (keys.size >= CONTENT_LIMITS.reasons) throw conflict(`The list can hold up to ${CONTENT_LIMITS.reasons} reasons.`);
    const sortOrder = Math.max(VISIT_REASONS.length - 1, ...all.map((r) => r.sortOrder)) + 1;
    const row = await db.visitReasonContent.create({ data: { ...defaultRow(reason, label.trim()), sortOrder } });
    await adminEvent(admin, "visit_content_changed", { reason, change: "reason_added", label: row.label }, db);
    return summarise(reason, [row]);
  });
}

export async function setReasonOrder(admin: AdminPrincipal, order: string[]): Promise<ReasonSummary[]> {
  await prisma.$transaction(async (db) => {
    const all = await db.visitReasonContent.findMany();
    const keys = new Set([...VISIT_REASONS, ...all.map((r) => r.reason)]);
    if (order.length !== keys.size || new Set(order).size !== order.length || order.some((k) => !keys.has(k))) {
      throw new AdminApiError(400, "VALIDATION", "Send every reason once, in the new order.", { reasons: ["Send every reason once, in the new order."] });
    }
    for (const [i, reason] of order.entries()) {
      await materialise(reason, db);
      await db.visitReasonContent.updateMany({ where: { reason }, data: { sortOrder: i } });
    }
    await adminEvent(admin, "visit_content_changed", { change: "order_set", order }, db);
  });
  return listReasons();
}

export async function setReasonActive(admin: AdminPrincipal, reason: string, active: boolean): Promise<ReasonSummary[]> {
  await prisma.$transaction(async (db) => {
    const rows = await materialise(reason, db);
    if (!active && rows.some((r) => r.active)) {
      const others = (await listReasons()).filter((r) => r.reason !== reason && r.active);
      if (others.length === 0) throw conflict("Installers must have at least one reason to pick.");
    }
    await db.visitReasonContent.updateMany({ where: { reason }, data: { active } });
    await adminEvent(admin, "visit_content_changed", { reason, change: active ? "shown" : "hidden" }, db);
  });
  return listReasons();
}

export const JOINED_NOW_HOURS = 24;

export type ConversionRow = {
  reason: string;
  label: string;
  variant: string;
  offers: number;
  viewed: number;
  joined: number;
  thinking: number;
  joinedLater: number;
};

export type ConversionReport = { from: string; to: string; joinedNowHours: number; rows: ConversionRow[] };

export async function conversionReport(range: { from: Date; to: Date }): Promise<ConversionReport> {
  const [sessions, marks, labels] = await Promise.all([
    prisma.offerSession.findMany({
      where: { createdAt: { gte: range.from, lt: range.to } },
      select: { engineerId: true, reason: true, variant: true, channel: true, createdAt: true, planId: true },
    }),
    testMarks(),
    listReasons(),
  ]);
  const test = new Set(marks.engineers);
  const real = sessions.filter((s) => !test.has(s.engineerId));
  const planIds = real.map((s) => s.planId).filter((id): id is string => Boolean(id));
  const plans = new Map<string, { linkOpenedAt: Date | null; activatedAt: Date | null }>();
  for (let i = 0; i < planIds.length; i += 1000) {
    const batch = await prisma.plan.findMany({ where: { id: { in: planIds.slice(i, i + 1000) } }, select: { id: true, linkOpenedAt: true, activatedAt: true } });
    for (const p of batch) plans.set(p.id, p);
  }
  const labelOf = new Map(labels.map((l) => [l.reason, l.label]));
  const rows = new Map<string, ConversionRow>();
  for (const s of real) {
    const key = `${s.reason}\u0000${s.variant}`;
    let row = rows.get(key);
    if (!row) {
      row = { reason: s.reason, label: labelOf.get(s.reason) ?? defaultContent("other").label, variant: s.variant, offers: 0, viewed: 0, joined: 0, thinking: 0, joinedLater: 0 };
      rows.set(key, row);
    }
    const plan = s.planId ? plans.get(s.planId) : undefined;
    const viewed = s.channel === "show" || Boolean(plan?.linkOpenedAt);
    const joinedAfterMs = plan?.activatedAt ? plan.activatedAt.getTime() - s.createdAt.getTime() : null;
    const joinedNow = joinedAfterMs !== null && joinedAfterMs <= JOINED_NOW_HOURS * 3_600_000;
    row.offers++;
    if (viewed) row.viewed++;
    if (joinedNow) row.joined++;
    else if (viewed) row.thinking++;
    if (joinedAfterMs !== null && !joinedNow) row.joinedLater++;
  }
  const order = new Map(labels.map((l, i) => [l.reason, i]));
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    joinedNowHours: JOINED_NOW_HOURS,
    rows: [...rows.values()].sort((a, b) => (order.get(a.reason) ?? 99) - (order.get(b.reason) ?? 99) || a.reason.localeCompare(b.reason) || a.variant.localeCompare(b.variant)),
  };
}
