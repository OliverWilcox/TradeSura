import { describe, expect, it } from "vitest";
import { normaliseClaimCode } from "@/lib/claim";
import { referralStage } from "@/lib/referral";

describe("claim code normalisation", () => {
  it("upcases and strips spaces/dashes into TS-NNNNN", () => {
    expect(normaliseClaimCode("ts 48217")).toBe("TS-48217");
    expect(normaliseClaimCode("TS-48217")).toBe("TS-48217");
    expect(normaliseClaimCode("  ts48217 ")).toBe("TS-48217");
  });
  it("leaves an unrecognised shape as cleaned uppercase", () => {
    expect(normaliseClaimCode("hello-world")).toBe("HELLOWORLD");
  });
});

// Build Review 2, ruling 4 — "Signed up → Verified → Plan live → Earning."
describe("referral stage", () => {
  it("signed_up: no badge, no plan", () =>
    expect(referralStage({ verified: false, activePlans: 0, earnedPence: 0 })).toBe("signed_up"));
  it("verified: badge granted, no plan yet", () =>
    expect(referralStage({ verified: true, activePlans: 0, earnedPence: 0 })).toBe("verified"));
  it("plan_live: a plan is active but nothing has been collected yet", () =>
    expect(referralStage({ verified: true, activePlans: 1, earnedPence: 0 })).toBe("plan_live"));
  it("plan_live outranks an unset verified flag — activation implies it", () =>
    expect(referralStage({ verified: false, activePlans: 1, earnedPence: 0 })).toBe("plan_live"));
  it("earning once any commission is recorded, regardless of current plan count", () =>
    expect(referralStage({ verified: true, activePlans: 0, earnedPence: 240 })).toBe("earning"));
});
