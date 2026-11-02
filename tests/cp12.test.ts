// Review 4 — the CP12 follows the 3rd-payment rule; a landlord whose record
// runs out before then is warned and offered a one-off CP12.
import { describe, expect, it } from "vitest";
import { cp12AvailableFrom, parseRecordDue, recordDueBeforeCover, tierHasCp12 } from "@/lib/cp12";
import { CLAUSE_TEMPLATES } from "@/lib/clauses";

const signup = new Date("2026-11-02T10:00:00Z");

describe("CP12 availability", () => {
  it("is the start of the third paid month: cooling-off end + 2 months", () => {
    // Cooling-off ends 16 Nov; third collection 16 Jan.
    expect(cp12AvailableFrom(signup).toISOString().slice(0, 10)).toBe("2027-01-16");
  });

  it("warns when the current record is due before then", () => {
    expect(recordDueBeforeCover(new Date("2026-12-20T12:00:00Z"), signup)).toBe(true);
    expect(recordDueBeforeCover(new Date("2027-03-01T12:00:00Z"), signup)).toBe(false);
  });

  it("the CP12 clause carries the 3rd-payment small print", () => {
    const cp12 = CLAUSE_TEMPLATES.find((c) => c.code === "CP12")!;
    expect(cp12.note).toBe("available after your third payment");
    expect(cp12.engineerNote).toBe("available after the customer's 3rd payment");
    expect(cp12.bodyText).toContain("third monthly payment");
    expect(tierHasCp12(["ANNUAL_SERVICE", "CP12"])).toBe(true);
    expect(tierHasCp12(["ANNUAL_SERVICE"])).toBe(false);
  });
});

describe("parseRecordDue", () => {
  it("takes a real calendar date in range", () => {
    expect(parseRecordDue("2026-12-03", signup)?.toISOString().slice(0, 10)).toBe("2026-12-03");
  });
  it("rejects typos, impossible dates and blanks", () => {
    expect(parseRecordDue("2026-02-30", signup)).toBeNull();
    expect(parseRecordDue("2031-01-01", signup)).toBeNull();
    expect(parseRecordDue("2024-01-01", signup)).toBeNull();
    expect(parseRecordDue("", signup)).toBeNull();
    expect(parseRecordDue(undefined, signup)).toBeNull();
  });
  it("accepts an overdue record from this year (warned, not blocked)", () => {
    const d = parseRecordDue("2026-10-01", signup)!;
    expect(recordDueBeforeCover(d, signup)).toBe(true);
  });
});
