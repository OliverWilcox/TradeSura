import { describe, expect, it } from "vitest";
import { normaliseClaimCode } from "@/lib/claim";
import { referralStage, REFERRAL_REQUIRED_PLANS } from "@/lib/referral";

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

describe("referral stage", () => {
  it("signed_up with no plans", () => expect(referralStage(0, false)).toBe("signed_up"));
  it("building with some plans", () => expect(referralStage(3, false)).toBe("building"));
  it("still building at the threshold until the bounty check runs", () =>
    expect(referralStage(REFERRAL_REQUIRED_PLANS, false)).toBe("building"));
  it("paid once the bounty is marked", () =>
    expect(referralStage(9, true)).toBe("paid"));
});
