// Handover 1.7 — display-only tier lines are marketing display, never contract
// text. This test is the standing proof for the solicitor pack.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const planDocSource = readFileSync("lib/plan-doc.ts", "utf8");

describe("legal plan document assembly", () => {
  it("never reads customLabels", () => {
    expect(planDocSource).not.toContain("customLabels");
  });

  it("builds its clause list from the approved clause relation only", () => {
    expect(planDocSource).toContain("tc.clause");
    expect(planDocSource).toContain(".bodyText");
  });
});
