import { describe, expect, it } from "vitest";
import { officerMatches } from "@/lib/companies-house";

describe("officer name match", () => {
  it("matches Companies House 'SURNAME, Forenames' against first and last name", () => {
    expect(officerMatches("SMITH, David John", "David", "Smith")).toBe(true);
  });
  it("doesn't match a different first name", () => {
    expect(officerMatches("SMITH, Daniel", "David", "Smith")).toBe(false);
  });
  it("needs both names", () => {
    expect(officerMatches("SMITH, David", null, "Smith")).toBe(false);
  });
});
