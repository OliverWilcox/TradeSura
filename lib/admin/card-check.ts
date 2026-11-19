import { prisma } from "@/lib/db";
import type { GasSafeCardRead } from "@/lib/generated/prisma/client";
import { cardReadConfigured, nameProblem, REGISTRATION_DIGITS } from "@/lib/card-read";
import { matchPersonName } from "@/lib/admin/names";
import { formatUkDate } from "@/lib/admin/time";

export type AutomaticResult = "passed" | "failed" | "waiting";

export type CardField = "licenceNo" | "registrationNo" | "name" | "expiresOn";

export const REQUIRED_CARD_FIELDS: readonly CardField[] = ["licenceNo", "registrationNo", "name", "expiresOn"];

const FIELD_LABEL: Record<CardField, string> = {
  licenceNo: "licence number",
  registrationNo: "registration number",
  name: "name",
  expiresOn: "expiry date",
};

export const autoPassOn = () => process.env.CARD_CHECK_AUTO_PASS?.trim() !== "0";

export type CardDetails = {
  source: "automatic" | "checker";
  outcome: string;
  complete: boolean;
  licenceNo: string | null;
  registrationNo: string | null;
  name: string | null;
  company: string | null;
  expiresOn: string | null;
  categories: string[];
  notes: string[];
  readAt: string;
  readBy: string | null;
  backRead: boolean;
  suspect: boolean;
};

export type CardCheckView = {
  automatic: AutomaticResult | null;
  reasons: string[];
  concerns: string[];
  details: CardDetails | null;
  missing: CardField[];
  expired: boolean;
  passedWithoutDetails: boolean;
};

export const dateOf = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

export function readComplete(r: { outcome: string; isGasSafeCard: boolean | null; licenceNo: string | null; registrationNo: string | null; name: string | null; expiresOn: Date | string | null }): boolean {
  return r.outcome === "read" && r.isGasSafeCard !== false && Boolean(r.licenceNo && r.registrationNo && r.name?.trim() && r.expiresOn);
}

export function detailsOf(r: GasSafeCardRead | null): CardDetails | null {
  if (!r) return null;
  return {
    source: r.source === "checker" ? "checker" : "automatic",
    outcome: r.outcome,
    complete: r.complete,
    licenceNo: r.licenceNo,
    registrationNo: r.registrationNo,
    name: r.name,
    company: r.company,
    expiresOn: dateOf(r.expiresOn),
    categories: r.categories,
    notes: r.notes,
    readAt: r.createdAt.toISOString(),
    readBy: r.source === "checker" ? r.readByName : null,
    backRead: Boolean(r.backUrl),
    suspect: r.suspect,
  };
}

export type ReadsOf = { read: GasSafeCardRead | null; automatic: GasSafeCardRead | null; passed: GasSafeCardRead | null };

export async function currentReads(rows: { id: string; gasSafeCardUrl: string | null; gasSafeCardReadId: string | null }[]): Promise<Map<string, ReadsOf>> {
  const out = new Map<string, ReadsOf>(rows.map((r) => [r.id, { read: null, automatic: null, passed: null }]));
  const withCard = rows.filter((r) => r.gasSafeCardUrl);
  const passedIds = rows.map((r) => r.gasSafeCardReadId).filter((id): id is string => !!id);
  if (!withCard.length && !passedIds.length) return out;
  const reads = await prisma.gasSafeCardRead.findMany({
    where: { OR: [...withCard.map((r) => ({ engineerId: r.id, cardUrl: r.gasSafeCardUrl! })), ...(passedIds.length ? [{ id: { in: passedIds } }] : [])] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const r of reads) {
    const row = byId.get(r.engineerId);
    const o = out.get(r.engineerId);
    if (!row || !o) continue;
    if (r.id === row.gasSafeCardReadId) o.passed = r;
    if (r.cardUrl !== row.gasSafeCardUrl) continue;
    if (!o.automatic && r.source === "automatic") o.automatic = r;
    if (!o.read || (r.complete && !o.read.complete)) o.read = r;
  }
  return out;
}

const ukDate = (day: string) => formatUkDate(new Date(`${day}T12:00:00Z`));

const sameDigits = (a: string | null, b: string | null) => (a ?? "").replace(/\D/g, "") === (b ?? "").replace(/\D/g, "");

export const listOf = (items: string[]) => (items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

const missingOf = (d: CardDetails | null) => REQUIRED_CARD_FIELDS.filter((f) => !d?.[f]);

export const READING_MINUTES = 10;

function automaticResult(a: CardDetails | null, today: string, reading: boolean): { result: AutomaticResult; reason: string | null } {
  if (!a || a.outcome === "not_set_up") {
    if (!cardReadConfigured()) return { result: "waiting", reason: "The automatic check isn't set up, so a person reads the card." };
    return {
      result: "waiting",
      reason: !a && reading ? "The automatic check is still reading the card." : "The automatic check hasn't read this card. Press Read the card again, or enter the details from the photo.",
    };
  }
  if (a.outcome === "error") return { result: "waiting", reason: a.notes[0] ?? "The automatic check couldn't run." };
  if (a.outcome === "not_a_card") return { result: "failed", reason: "The automatic check says the photo isn't a Gas Safe ID card." };
  if (a.outcome === "unreadable") return { result: "failed", reason: a.notes[0] ?? "The automatic check couldn't open the photo." };
  const missing = missingOf(a);
  if (missing.length) return { result: "failed", reason: `It couldn't read the card's ${listOf(missing.map((f) => FIELD_LABEL[f]))}${a.notes.length ? `: ${a.notes[0]}` : "."}` };
  if (a.expiresOn && a.expiresOn < today) return { result: "failed", reason: `The card expired on ${ukDate(a.expiresOn)}.` };
  return { result: "passed", reason: null };
}

export function cardCheckView(input: {
  hasCard: boolean;
  read: GasSafeCardRead | null;
  automaticRead: GasSafeCardRead | null;
  live: boolean;
  passed: boolean;
  newCard?: boolean;
  given: { licenceNo: string | null; registrationNo: string | null; firstName: string | null; lastName: string | null };
  warnings?: { code: string; message: string }[];
  today: string;
  uploadedAt?: Date | null;
  now?: Date;
  officersChecked?: boolean;
}): CardCheckView {
  const details = detailsOf(input.read);
  const passedWithoutDetails = input.live && !input.passed;
  const reasons: string[] = [];
  const concerns: string[] = [];
  if (passedWithoutDetails) reasons.push("Marked live before cards were read, so there's no record of their card's details.");
  if (input.newCard) reasons.push("They've sent a new card since their card check passed. It needs reading before the register check can pass.");
  if (!input.hasCard) {
    reasons.push("There's no photo of their Gas Safe ID card yet.");
    return { automatic: null, reasons, concerns, details: null, missing: [...REQUIRED_CARD_FIELDS], expired: false, passedWithoutDetails };
  }
  const missing = missingOf(details);
  const expired = Boolean(details?.expiresOn && details.expiresOn < input.today);
  const now = input.now ?? new Date();
  const reading = Boolean(input.uploadedAt && now.getTime() - input.uploadedAt.getTime() < READING_MINUTES * 60_000);
  const auto = automaticResult(detailsOf(input.automaticRead), input.today, reading);
  if (auto.reason) reasons.push(auto.reason);
  if (details && details.outcome === "read") {
    if (details.licenceNo && input.given.licenceNo && !sameDigits(details.licenceNo, input.given.licenceNo)) {
      concerns.push(`The card's licence number, ${details.licenceNo}, isn't the ${input.given.licenceNo} they gave.`);
    }
    if (details.registrationNo && input.given.registrationNo && !sameDigits(details.registrationNo, input.given.registrationNo)) {
      concerns.push(`The card's registration number, ${details.registrationNo}, isn't the ${input.given.registrationNo} they gave.`);
    }
    if (details.registrationNo && details.registrationNo.length < REGISTRATION_DIGITS) {
      concerns.push(`The card's registration number, ${details.registrationNo}, is shorter than the usual ${REGISTRATION_DIGITS} digits. Check it on the Gas Safe Register.`);
    }
    if (details.suspect) concerns.push("The automatic check thinks this may not be a photo of the card itself: a picture of a screen, a print or an edited image. Look closely before passing.");
    if (details.name) {
      if (nameProblem(details.name) === "stand_in") concerns.push(`The name on the card, ${details.name}, is often a stand-in for a real name. Check it against the card before passing.`);
      const match = matchPersonName(details.name, input.given.firstName, input.given.lastName);
      if (match === "none") concerns.push(`The name on the card, ${details.name}, doesn't match the account's name.`);
      else if (match === "likely") concerns.push(`The name on the card, ${details.name}, is only a likely match for the account's name.`);
    }
  }
  for (const w of input.warnings ?? []) {
    if (w.code !== "no_card" && w.code !== "card_expired" && !concerns.includes(w.message)) concerns.push(w.message);
  }
  if (auto.result === "passed" && !concerns.length && !input.passed && !input.newCard) {
    reasons.push(
      !autoPassOn()
        ? "Automatic passing is switched off, so a person passes every card."
        : input.officersChecked === false
          ? "Read in full. The company's officers are checked when you open the case."
          : "Read in full with nothing to check: ready to pass.",
    );
  }
  return { automatic: auto.result, reasons: [...reasons, ...concerns], concerns, details, missing, expired, passedWithoutDetails };
}

export function cardPassBlock(view: CardCheckView): string | null {
  if (!view.details && view.missing.length === REQUIRED_CARD_FIELDS.length && view.automatic === null) return "There's no card photo to check yet. Chase them for it.";
  if (view.details?.outcome === "not_a_card" && view.details.source === "automatic") return "The photo isn't a Gas Safe ID card. Enter the details from the card if it is one, or chase them for a photo of it.";
  if (view.missing.length) return `The card's ${listOf(view.missing.map((f) => FIELD_LABEL[f]))} ${view.missing.length === 1 ? "hasn't" : "haven't"} been read. Enter ${view.missing.length === 1 ? "it" : "them"} from the photo, or chase them for a clearer one.`;
  if (view.expired) return `The card expired on ${ukDate(view.details!.expiresOn!)}. Ask them for their current card.`;
  return null;
}
