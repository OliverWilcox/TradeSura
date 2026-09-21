// Handover 1.7 — display-only tier lines are marketing display, never contract
// text. This test is the standing proof for the solicitor pack.
//
// The plan document (and every other read of the agreed plan) now assembles
// through lib/plan-tier.ts's snapshot, so the guarantee spans both files.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const planDocSource = readFileSync("lib/plan-doc.ts", "utf8");
const planTierSource = readFileSync("lib/plan-tier.ts", "utf8");

describe("legal plan document assembly", () => {
  it("never reads customLabels anywhere on the agreed-plan path", () => {
    expect(planDocSource).not.toContain("customLabels");
    expect(planTierSource).not.toContain("customLabels");
  });

  it("assembles from the agreed tier snapshot, not the live tier", () => {
    expect(planDocSource).toContain("resolvePlanTier");
  });

  it("the snapshot is built from the approved clause relation only", () => {
    expect(planTierSource).toContain("tc.clause");
    expect(planTierSource).toContain("bodyText");
  });
});
