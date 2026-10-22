// CLAUDE.md §Compliance 1 — plan wording is locked. Free-text service
// descriptions must never contain insurance-product promises.
import { CLAUSE_TEMPLATES } from "@/lib/clauses";

const BLOCKED: { re: RegExp; label: string; suggestCode: string }[] = [
  { re: /\bbreak[\s-]?downs?\b/i, label: "breakdown", suggestCode: "PRIORITY_48H" },
  {
    re: /\b(free\s+repairs?|repairs?\s+(are\s+)?(included|free)|includ(es?|ing)\s+(free\s+)?repairs?)\b/i,
    label: "repairs included/free",
    suggestCode: "NO_CALLOUT_FEE",
  },
  { re: /\bwe(\s+will|['’]ll)\s+fix\b/i, label: "we will fix", suggestCode: "PRIORITY_48H" },
  {
    re: /\bguaranteed?\s+(response|fix(es)?)\b/i,
    label: "guaranteed response/fix",
    suggestCode: "PRIORITY_48H",
  },
  { re: /\binsurance\b/i, label: "insurance", suggestCode: "ANNUAL_SERVICE" },
  // Build Guide v2 Part 18 blocklist — bare "guarantee" and "emergency
  // response" are banned anywhere a customer could read them, not just in
  // the "guaranteed fix" phrasing above.
  { re: /\bguarantee[sd]?\b/i, label: "guarantee", suggestCode: "PRIORITY_48H" },
  {
    re: /\bemergency\s+(response|call[\s-]?outs?|cover)\b/i,
    label: "emergency response",
    suggestCode: "PRIORITY_48H",
  },
  {
    re: /\bcover(ed)?\s+(for|against)\s+break[\s-]?downs?\b/i,
    label: "cover for breakdowns",
    suggestCode: "PRIORITY_48H",
  },
  // Handover §3 BLOCKED list — these make the plan an insurance product.
  {
    re: /\bparts\s+(are\s+)?included\b|\bincludes?\s+(all\s+)?parts\b/i,
    label: "parts included",
    suggestCode: "PARTS_DISCOUNT",
  },
  {
    re: /\breplacement\s+boiler\b|\bnew\s+boiler\s+(promise|guarantee[d]?|included)\b/i,
    label: "replacement boiler promise",
    suggestCode: "NEW_BOILER_DISCOUNT",
  },
  {
    re: /\bunlimited\s+(repairs?|call[\s-]?outs?|visits?)\b/i,
    label: "unlimited repairs",
    suggestCode: "NO_CALLOUT_FEE",
  },
  {
    re: /\balternative\s+accommodation\b/i,
    label: "alternative accommodation",
    suggestCode: "PRIORITY_48H",
  },
  { re: /\binsured\b/i, label: "insured", suggestCode: "ANNUAL_SERVICE" },
  {
    re: /\bprotected\s+against\b/i,
    label: "protected against",
    suggestCode: "ANNUAL_SERVICE",
  },
  // Broad "cover" language last so the specific rules above give the better
  // suggestion first.
  { re: /\bcover(ed|age)?\b/i, label: "cover", suggestCode: "ANNUAL_SERVICE" },
];

export type WordingResult =
  | { ok: true }
  | {
      ok: false;
      phrase: string;
      explanation: string;
      suggestion: { code: string; title: string };
    };

// Review 3 P0 — "Boiler Cover" was blocked but "BoilerCover" got through.
// Free text is checked three ways: as typed, with punctuation turned into
// spaces, and squashed (no spaces at all) against banned stems — each after
// lower-casing and mapping look-alike characters. 1 can stand for i or l,
// so both readings are tried.
const LOOK_ALIKES: Record<string, string> = { "0": "o", "3": "e", "@": "a", $: "s", "4": "a", "5": "s", "7": "t" };

// Innocent words that contain a banned stem. Removed before squashing.
const ALLOWED_WORDS = /\b(dis|re|un)cover(s|ed|ing|y|ies)?\b/g;

// Banned stems matched anywhere inside the squashed text — also catches
// plurals ("covers"), run-together words and common misspellings.
const STEMS: { stem: string; label: string; suggestCode: string }[] = [
  ...["breakdown", "brakedown", "breakdwn", "brekdown", "breakedown"].map((stem) => ({
    stem,
    label: "breakdown",
    suggestCode: "PRIORITY_48H",
  })),
  ...["insur", "insrance", "inshur"].map((stem) => ({
    stem,
    label: "insurance",
    suggestCode: "ANNUAL_SERVICE",
  })),
  ...["guarant", "gaurant", "guarent", "garant", "guarrant"].map((stem) => ({
    stem,
    label: "guarantee",
    suggestCode: "PRIORITY_48H",
  })),
  ...["emergenc", "emergancy", "emergancey", "emergensy", "emergancies"].map((stem) => ({
    stem,
    label: "emergency",
    suggestCode: "PRIORITY_48H",
  })),
  ...["wellfix", "wewillfix", "willfixit", "freerepair", "repairsincluded", "repairincluded", "repairsfree", "includesrepair", "includingrepair", "partsincluded", "includesparts", "replacementboiler", "unlimitedrepair", "unlimitedcallout", "unlimitedvisit", "alternativeaccommodation", "protectedagainst"].map((stem) => ({
    stem,
    label: stem.includes("parts") ? "parts included" : stem.includes("boiler") ? "replacement boiler promise" : "repairs included/free",
    suggestCode: stem.includes("parts") ? "PARTS_DISCOUNT" : stem.includes("boiler") ? "NEW_BOILER_DISCOUNT" : "NO_CALLOUT_FEE",
  })),
  // Broad "cover" last so the specific stems above give the better suggestion.
  ...["cover", "kover", "cuver", "covver"].map((stem) => ({ stem, label: "cover", suggestCode: "ANNUAL_SERVICE" })),
];

function readings(text: string): string[] {
  const lower = text.toLowerCase().replace(/[0-9@$]/g, (c) => LOOK_ALIKES[c] ?? c);
  return lower.includes("1") ? [lower.replace(/1/g, "i"), lower.replace(/1/g, "l")] : [lower];
}

function blocked(label: string, suggestCode: string): WordingResult {
  const clause = CLAUSE_TEMPLATES.find((c) => c.code === suggestCode)!;
  return {
    ok: false,
    phrase: label,
    explanation:
      "That wording makes this an insurance product. Plans can only promise maintenance and priority service — TradeSura keeps you on the right side of the line.",
    suggestion: { code: clause.code, title: clause.title },
  };
}

export function checkWording(text: string): WordingResult {
  for (const reading of readings(text)) {
    const spaced = reading.replace(/[^a-z\s]+/g, " ").replace(/\s+/g, " ").trim();
    for (const form of [reading, spaced]) {
      for (const b of BLOCKED) {
        if (b.re.test(form)) return blocked(b.label, b.suggestCode);
      }
    }
    const squashed = spaced.replace(ALLOWED_WORDS, " ").replace(/[^a-z]/g, "");
    for (const s of STEMS) {
      if (squashed.includes(s.stem)) return blocked(s.label, s.suggestCode);
    }
  }
  return { ok: true };
}
