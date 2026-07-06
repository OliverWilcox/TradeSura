// Hit/miss need the local Prisma Postgres dev server running (npx prisma dev)
// and the importer run (npm run import:gas-safe).
import "dotenv/config";
import { describe, expect, it } from "vitest";
import { normaliseRegNo, verifyGasSafe } from "@/lib/gas-safe";

describe("normaliseRegNo", () => {
  it("strips spaces", () => expect(normaliseRegNo("584 123")).toBe("584123"));
  it("rejects letters", () => expect(normaliseRegNo("ABC123")).toBeNull());
  it("rejects empty", () => expect(normaliseRegNo("   ")).toBeNull());
  it("rejects too short", () => expect(normaliseRegNo("12")).toBeNull());
  it("rejects too long", () => expect(normaliseRegNo("123456789012")).toBeNull());
});

describe("verifyGasSafe (integration)", () => {
  it("hit: returns register record", async () => {
    const r = await verifyGasSafe("584 123");
    expect(r?.name).toBe("D. Smith");
    expect(r?.company).toBe("Smith Heating Ltd");
  });
  it("miss: unknown number returns null", async () => {
    expect(await verifyGasSafe("999999")).toBeNull();
  });
  it("malformed: returns null without querying", async () => {
    expect(await verifyGasSafe("not-a-number")).toBeNull();
  });
});
