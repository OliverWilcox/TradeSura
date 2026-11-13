import { describe, expect, it } from "vitest";
import { claimCodeWhere, normaliseClaimCode } from "@/lib/claim";
import { CODE_ALPHABET, letterCodeSuffix } from "@/lib/letter-code";
import { referralStage } from "@/lib/referral";
import { findClaimCode } from "../mobile/lib/claim-code";

describe("claim code normalisation", () => {
  it("upcases and strips spaces/dashes into TS-NNNNN", () => {
    expect(normaliseClaimCode("ts 48217")).toBe("TS-48217");
    expect(normaliseClaimCode("TS-48217")).toBe("TS-48217");
    expect(normaliseClaimCode("  ts48217 ")).toBe("TS-48217");
  });
  it("puts a letter code's dash back however it was typed (Matt, 4 Nov)", () => {
    for (const typed of ["SMITH-7K3Q", "smith 7k3q", "smith7k3q", " Smith-7k3q "]) expect(normaliseClaimCode(typed)).toBe("SMITH-7K3Q");
    expect(normaliseClaimCode("o'brien-kk3q")).toBe("OBRIEN-KK3Q");
  });
  it("leaves an unrecognised shape as cleaned uppercase", () => {
    expect(normaliseClaimCode("hello-world")).toBe("HELLOWORLD");
    // Four letters with no digit isn't a code's ending.
    expect(normaliseClaimCode("first-name")).toBe("FIRSTNAME");
  });
});

describe("finding a code row (nothing that was found before stops being found)", () => {
  // The normaliser as it was before letter codes (12 Nov).
  const before = (input: string) => {
    const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const m = cleaned.match(/^TS(\d{4,8})$/);
    return m ? `TS-${m[1]}` : cleaned;
  };

  it("looks a TS- code up exactly as before, and a letter code in its printed form and its bare one", () => {
    expect(claimCodeWhere("ts 48217")).toEqual({ code: { in: ["TS-48217"] } });
    expect(claimCodeWhere("smith 7k3q")).toEqual({ code: { in: ["SMITH-7K3Q", "SMITH7K3Q"] } });
    expect(claimCodeWhere("hello-world")).toEqual({ code: { in: ["HELLOWORLD"] } });
  });

  it("always includes what the earlier normaliser gave, whatever is typed", () => {
    const typed = ["TS-48217", "ts48217", "TS 1234", "TS-123456789", "SMITH-7K3Q", "smith7k3q", "abcde234", "ABCDE-234", "o'brien kk3q", "X", "", "12345", "AB12CD", "  mw heating  "];
    for (const t of typed) expect(claimCodeWhere(t).code.in, t).toContain(before(t));
  });
});

describe("letter codes (Matt, 4 Nov: non-guessable)", () => {
  it("end in four characters a phone call can't mix up, at least one a digit", () => {
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
    const suffixes = Array.from({ length: 2000 }, letterCodeSuffix);
    for (const s of suffixes) expect(s).toMatch(/^(?=.*\d)[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    // Drawn at random: 2,000 draws from about 600,000 endings barely repeat.
    expect(new Set(suffixes).size).toBeGreaterThan(1990);
    // Every character turns up, so none is left out of the draw.
    expect(new Set(suffixes.join(""))).toEqual(new Set(CODE_ALPHABET));
  });

  it("are found by the app the way the server reads them, typed or pasted", () => {
    const cases: [string, string | null][] = [
      ["SMITH-7K3Q", "SMITH-7K3Q"],
      ["smith 7k3q", "SMITH-7K3Q"],
      ["smith7k3q", "SMITH-7K3Q"],
      ["Scan the code or go to https://tradesura.com/c/SMITH-7K3Q", "SMITH-7K3Q"],
      ["Your code is TS-48217", "TS-48217"],
      ["ts 48217", "TS-48217"],
      // Ordinary words and links without a code aren't taken for one.
      ["Fill in your first-name here", null],
      ["https://tradesura.com/claim", null],
      ["", null],
    ];
    for (const [text, code] of cases) {
      expect(findClaimCode(text), text).toBe(code);
      if (code) expect(normaliseClaimCode(code)).toBe(code);
    }
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
