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

export function checkWording(text: string): WordingResult {
  for (const b of BLOCKED) {
    if (b.re.test(text)) {
      const clause = CLAUSE_TEMPLATES.find((c) => c.code === b.suggestCode)!;
      return {
        ok: false,
        phrase: b.label,
        explanation:
          "That wording makes this an insurance product. Plans can only promise maintenance and priority service — TradeSura keeps you on the right side of the line.",
        suggestion: { code: clause.code, title: clause.title },
      };
    }
  }
  return { ok: true };
}
