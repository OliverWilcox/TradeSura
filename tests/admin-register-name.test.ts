import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { registerNameMatches } = await import("@/lib/admin/verifications");

// The admin verification queue's register hint: the Gas Safe register lists
// "D. Smith", so a match is the same surname and first initial. A hint for
// the checker, never a decision.

describe("matching an applicant to the Gas Safe register", () => {
  it("matches the surname and first initial", () => {
    expect(registerNameMatches("D. Smith", "Dave", "Smith")).toBe(true);
    expect(registerNameMatches("D. Smith", "dave", "SMITH")).toBe(true);
  });

  it("doesn't match a different surname or initial", () => {
    expect(registerNameMatches("D. Smith", "Dave", "Smyth")).toBe(false);
    expect(registerNameMatches("P. Smith", "Dave", "Smith")).toBe(false);
  });

  it("handles hyphens, apostrophes and accents", () => {
    expect(registerNameMatches("J. Armstrong-Medhurst", "Justin", "Armstrong-Medhurst")).toBe(true);
    expect(registerNameMatches("S. O'Brien", "Siobhan", "O'Brien")).toBe(true);
    expect(registerNameMatches("Z. Zoë-Brontë", "Zoe", "Zoe-Bronte")).toBe(true);
  });

  it("needs both names", () => {
    expect(registerNameMatches("D. Smith", null, "Smith")).toBe(false);
    expect(registerNameMatches("D. Smith", "Dave", "  ")).toBe(false);
    expect(registerNameMatches("Smith", "Dave", "Smith")).toBe(false);
  });
});
