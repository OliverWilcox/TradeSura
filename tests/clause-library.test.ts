import { describe, expect, it } from "vitest";
import { CLAUSE_TEMPLATES, TIER_PRESETS, suggestedPricePence, withRequiredClauses } from "@/lib/clauses";
import { checkWording } from "@/lib/compliance/blocklist";

describe("plan service library", () => {
  it("has unique codes", () => {
    const codes = CLAUSE_TEMPLATES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // The library is what an engineer ships to customers — no clause may contain
  // wording the blocklist would reject from a custom line.
  for (const c of CLAUSE_TEMPLATES) {
    it(`clause passes the blocklist: ${c.code}`, () => {
      expect(checkWording(c.title).ok, `title: ${c.title}`).toBe(true);
      expect(checkWording(c.bodyText).ok, `body: ${c.code}`).toBe(true);
    });
  }

  it("every preset references real clause codes", () => {
    const codes = new Set(CLAUSE_TEMPLATES.map((c) => c.code));
    for (const p of TIER_PRESETS) {
      for (const code of p.clauseCodes) expect(codes.has(code), `${p.name}: ${code}`).toBe(true);
    }
  });

  it("presets only use SAFE clauses — CARE needs solicitor sign-off first", () => {
    const care = new Set(CLAUSE_TEMPLATES.filter((c) => c.status === "CARE").map((c) => c.code));
    for (const p of TIER_PRESETS) {
      for (const code of p.clauseCodes) expect(care.has(code), `${p.name}: ${code}`).toBe(false);
    }
  });

  it("suggested price stacks uplifts on the base", () => {
    expect(suggestedPricePence([])).toBe(700);
    expect(suggestedPricePence([200, 150, null, 0])).toBe(1050);
  });

  // Build Guide v2 Part 7.1 LAW — required options are pre-ticked and
  // unremovable. This is the standing proof that no request, however
  // malformed, can produce a plan missing one.
  describe("withRequiredClauses", () => {
    it("adds every CORE code even from an empty selection", () => {
      const core = CLAUSE_TEMPLATES.filter((c) => c.kind === "CORE").map((c) => c.code);
      expect(withRequiredClauses([]).sort()).toEqual(core.sort());
    });

    it("never drops a CORE code the caller tries to omit", () => {
      const result = withRequiredClauses(["NO_CALLOUT_FEE"]);
      for (const c of CLAUSE_TEMPLATES.filter((c) => c.kind === "CORE")) {
        expect(result).toContain(c.code);
      }
      expect(result).toContain("NO_CALLOUT_FEE");
    });

    it("de-duplicates when the caller already included a CORE code", () => {
      const result = withRequiredClauses(["ANNUAL_SERVICE", "ANNUAL_SERVICE"]);
      expect(result.filter((c) => c === "ANNUAL_SERVICE")).toHaveLength(1);
    });
  });
});
