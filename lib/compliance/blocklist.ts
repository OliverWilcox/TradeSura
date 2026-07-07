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
  {
    re: /\bcover(ed)?\s+(for|against)\s+break[\s-]?downs?\b/i,
    label: "cover for breakdowns",
    suggestCode: "PRIORITY_48H",
  },
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
          "That wording makes this an insurance product. Plans can only promise maintenance and priority service — Tradeshura keeps you on the right side of the line.",
        suggestion: { code: clause.code, title: clause.title },
      };
    }
  }
  return { ok: true };
}
