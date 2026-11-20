import { describe, expect, it } from "vitest";
import { normaliseRegNo } from "@/lib/gas-safe";

describe("normaliseRegNo", () => {
  it("strips spaces", () => expect(normaliseRegNo("584 123")).toBe("584123"));
  it("rejects letters", () => expect(normaliseRegNo("ABC123")).toBeNull());
  it("rejects empty", () => expect(normaliseRegNo("   ")).toBeNull());
  it("takes the shorter numbers older registrations have, as the card check does", () => expect(normaliseRegNo("50134")).toBe("50134"));
  it("rejects all zeros", () => expect(normaliseRegNo("000000")).toBeNull());
  it("rejects 7 digits, the length of a licence number", () => expect(normaliseRegNo("1234567")).toBeNull());
  it("rejects too long", () => expect(normaliseRegNo("123456789012")).toBeNull());
});

describe("sign-up and the card check take the same registration numbers (N-08)", () => {
  it("agrees on every length", async () => {
    const { GAS_SAFE_REGISTRATION_NO } = await import("@/lib/validate");
    const { cleanRegistration } = await import("@/lib/card-read");
    for (const n of ["1", "07", "501", "5013", "50134", "584123", "1234567", "12345678", "0", "000000"]) {
      expect(GAS_SAFE_REGISTRATION_NO.test(n)).toBe(cleanRegistration(n) !== null);
    }
  });
});
