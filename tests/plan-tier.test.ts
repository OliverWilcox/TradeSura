// LAW (plan wording is locked) — editing a tier must never rewrite the plan
// document of a customer already on it. resolvePlanTier is the single point
// that guarantees it: an agreed snapshot always wins over the live tier.
import { describe, expect, it } from "vitest";
import { snapshotTier, resolvePlanTier } from "@/lib/plan-tier";

const liveTier = {
  name: "Boiler + Controls",
  isRecommended: true,
  clauses: [
    { clause: { code: "PRIORITY", title: "Priority call-outs", bodyText: "…", sortOrder: 2 } },
    { clause: { code: "ANNUAL_SERVICE", title: "Annual boiler service", bodyText: "…", sortOrder: 1 } },
  ],
};

describe("snapshotTier", () => {
  it("captures name + clauses in sort order and drops the relation wrapper", () => {
    const s = snapshotTier(liveTier);
    expect(s.name).toBe("Boiler + Controls");
    expect(s.isRecommended).toBe(true);
    expect(s.clauses.map((c) => c.code)).toEqual(["ANNUAL_SERVICE", "PRIORITY"]);
  });

  it("never carries customLabels into the snapshot", () => {
    expect(JSON.stringify(snapshotTier(liveTier))).not.toContain("customLabel");
  });
});

describe("resolvePlanTier", () => {
  it("prefers the agreed snapshot when the live tier has since changed", () => {
    const agreed = snapshotTier(liveTier);
    const editedLive = { ...liveTier, name: "Renamed cheaper plan", clauses: [] };
    const r = resolvePlanTier({ agreedTier: agreed, tier: editedLive });
    expect(r?.name).toBe("Boiler + Controls");
    expect(r?.clauses).toHaveLength(2);
    expect(r?.versioned).toBe(true);
  });

  it("falls back to the live tier for plans created before versioning", () => {
    const r = resolvePlanTier({ agreedTier: null, tier: liveTier });
    expect(r?.name).toBe("Boiler + Controls");
    expect(r?.clauses.map((c) => c.code)).toEqual(["ANNUAL_SERVICE", "PRIORITY"]);
    expect(r?.versioned).toBe(false);
  });

  it("ignores a malformed snapshot and uses the live tier", () => {
    const r = resolvePlanTier({ agreedTier: { name: "x" }, tier: liveTier });
    expect(r?.versioned).toBe(false);
  });

  it("returns null when there is neither a snapshot nor a live tier", () => {
    expect(resolvePlanTier({ agreedTier: null, tier: null })).toBeNull();
  });
});
