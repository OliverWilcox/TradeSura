import { describe, expect, it } from "vitest";
import { normaliseRegNo } from "@/lib/gas-safe";

describe("normaliseRegNo", () => {
  it("strips spaces", () => expect(normaliseRegNo("584 123")).toBe("584123"));
  it("rejects letters", () => expect(normaliseRegNo("ABC123")).toBeNull());
  it("rejects empty", () => expect(normaliseRegNo("   ")).toBeNull());
  it("rejects too short", () => expect(normaliseRegNo("12")).toBeNull());
  it("rejects too long", () => expect(normaliseRegNo("123456789012")).toBeNull());
});
