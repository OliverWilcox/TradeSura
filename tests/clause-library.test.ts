import { describe, expect, it } from "vitest";
import {
  CLAUSE_TEMPLATES,
  DEFAULT_ON_CLAUSE_CODES,
  TIER_PRESETS,
  TIER_PRICE_MIN_PENCE,
  appFeePence,
  clauseLine,
  isLandlordPlan,
  missingRateError,
  serviceRuleError,
  suggestedPricePence,
  withRequiredClauses,
} from "@/lib/clauses";
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
      const result = withRequiredClauses(["PRIORITY_48H", "PRIORITY_48H"]);
      expect(result.filter((c) => c === "PRIORITY_48H")).toHaveLength(1);
    });
  });

  // Build Review 2, rulings 1 and 2.
  describe("engineer-set plans", () => {
    it("has a £10 floor", () => {
      expect(TIER_PRICE_MIN_PENCE).toBe(1000);
    });

    it("pre-ticks the annual service without making it required", () => {
      expect(DEFAULT_ON_CLAUSE_CODES).toContain("ANNUAL_SERVICE");
      expect(withRequiredClauses([])).not.toContain("ANNUAL_SERVICE");
    });

    it("allows a plan without the annual service once another Core servicing item is on (R2)", () => {
      expect(serviceRuleError(withRequiredClauses(["GAS_FIRE_SERVICE"]))).toBeNull();
    });

    it("rejects a plan with no service and only non-maintenance options (R2/R3)", () => {
      expect(serviceRuleError(withRequiredClauses(["NO_CALLOUT_FEE"]))).toMatch(/Core gas servicing/);
      expect(serviceRuleError(withRequiredClauses([]))).toMatch(/Core gas servicing/);
    });

    it("needs the engineer's rate for 'you set the rate' options (R6)", () => {
      expect(missingRateError(["MULTI_APPLIANCE"], {})).toMatch(/Multi-appliance/);
      expect(missingRateError(["MULTI_APPLIANCE"], { MULTI_APPLIANCE: "10% off" })).toBeNull();
      expect(clauseLine({ code: "MULTI_APPLIANCE", title: "Multi-appliance discount" }, { MULTI_APPLIANCE: "10% off" })).toBe(
        "Multi-appliance discount: 10% off",
      );
    });

    it("treats any Landlord pack item as a Landlord plan (R9)", () => {
      expect(isLandlordPlan(["ANNUAL_SERVICE", "CP12"])).toBe(true);
      expect(isLandlordPlan(["ANNUAL_SERVICE"])).toBe(false);
    });

    it("rounds our 20% down to the penny (£15.99 → £3.19)", () => {
      expect(appFeePence(1599)).toBe(319);
      expect(appFeePence(1200)).toBe(240);
    });

    it("priority booking promises no attendance time (R1/R7)", () => {
      const p = CLAUSE_TEMPLATES.find((c) => c.code === "PRIORITY_48H")!;
      expect(p.title).toBe("Priority booking");
      expect(`${p.title} ${p.bodyText}`).not.toMatch(/48|hours|same-day/i);
      expect(CLAUSE_TEMPLATES.filter((c) => c.status === "SAFE").map((c) => c.code)).not.toContain("SAMEDAY_PRIORITY");
    });

    it("never blocks a plan that includes the service", () => {
      expect(serviceRuleError(withRequiredClauses(["ANNUAL_SERVICE"]))).toBeNull();
    });
  });

  it("makes the annual service optional, after the third payment", () => {
    const annual = CLAUSE_TEMPLATES.find((c) => c.code === "ANNUAL_SERVICE")!;
    expect(annual.kind).toBe("ADD");
    expect(annual.note).toMatch(/third payment/);
    expect(annual.bodyText).toMatch(/third monthly payment/);
  });

  it("clause notes pass the blocklist", () => {
    for (const c of CLAUSE_TEMPLATES) {
      if (c.note) expect(checkWording(c.note).ok, c.code).toBe(true);
      if (c.engineerNote) expect(checkWording(c.engineerNote).ok, c.code).toBe(true);
    }
  });
});
