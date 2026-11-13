// Claim codes are short and guessable (TS-48217). A bare code must only ever
// give back what's printed on the letter; the mobile and addresses confirmed
// on the claim page need the personal link's token; lookups are limited per IP.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  process.env.SESSION_SECRET = "test-secret-for-claim-privacy-0123456789";
  return { findFirst: vi.fn(), count: vi.fn(), create: vi.fn() };
});
vi.mock("@/lib/db", () => ({
  prisma: { claimCode: { findFirst: m.findFirst }, event: { count: m.count, create: m.create } },
}));
vi.mock("next/headers", () => ({ headers: async () => new Map() }));

import { SignJWT } from "jose";
import {
  CLAIM_LOOKUPS_PER_WINDOW,
  appTokenAllows,
  claimAppLink,
  claimAppToken,
  claimLookupLimited,
  resolveClaimCode,
} from "@/lib/claim";

const ROW = {
  code: "TS-48217",
  firstName: "Sam",
  businessName: "Holme Valley Heating",
  town: "Holmfirth",
  letterBatch: "L1",
  variantCell: "A",
  suppressedAt: null,
  redeemedByEngineerId: null,
  redeemedAt: null,
  createdAt: new Date(),
  claimedAt: new Date(),
  tradingAddress: "4 Mill Lane\nHolmfirth\nHD9 2AB",
  tradingTown: "Holmfirth",
  tradingTownSlug: "holmfirth",
  correspondenceAddress: null,
  mobile: "+447700900456",
  textConsentAt: new Date(),
  codeTextedAt: new Date(),
};

beforeEach(() => {
  m.findFirst.mockReset().mockResolvedValue(ROW);
  m.count.mockReset().mockResolvedValue(0);
  m.create.mockReset().mockResolvedValue({});
});

describe("claim code privacy", () => {
  it("a bare code gives back only the business name and town, never the confirmed details or list data", async () => {
    const r = await resolveClaimCode("ts 48217");
    expect(r).toEqual({
      valid: true,
      personalised: true,
      businessName: "Holme Valley Heating",
      town: "Holmfirth",
      letterBatch: "L1",
      variantCell: "A",
    });
    expect(JSON.stringify(r)).not.toContain("7700");
    expect(JSON.stringify(r)).not.toContain("Mill Lane");
    expect(JSON.stringify(r)).not.toContain("Sam");
  });

  it("the personal link's token unlocks the confirmed details for that code only", async () => {
    const token = await claimAppToken("TS-48217");
    const r = await resolveClaimCode("TS-48217", token);
    expect(r.valid && r.claimed).toEqual({
      tradingAddress: "4 Mill Lane\nHolmfirth\nHD9 2AB",
      tradingTown: "Holmfirth",
      correspondenceAddress: null,
      mobile: "+447700900456",
    });
    const other = await claimAppToken("TS-11111");
    const r2 = await resolveClaimCode("TS-48217", other);
    expect(r2.valid && r2.claimed).toBeUndefined();
    expect(await appTokenAllows("garbage", "TS-48217")).toBe(false);
  });

  it("rejects an expired token or one made for anything else", async () => {
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const expired = await new SignJWT({ purpose: "claim-app", code: "TS-48217" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    expect(await appTokenAllows(expired, "TS-48217")).toBe(false);
    const wrongPurpose = await new SignJWT({ purpose: "enable-sms", code: "TS-48217" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(key);
    expect(await appTokenAllows(wrongPurpose, "TS-48217")).toBe(false);
  });

  it("the texted link carries the token", async () => {
    const token = await claimAppToken("TS-48217");
    expect(claimAppLink("https://tradesura.com", "TS-48217", token)).toBe(
      `https://tradesura.com/c/TS-48217/app?t=${encodeURIComponent(token)}`,
    );
  });

  it("limits code lookups per IP", async () => {
    m.count.mockResolvedValueOnce(CLAIM_LOOKUPS_PER_WINDOW - 1);
    expect(await claimLookupLimited("ip-hash")).toBe(false);
    expect(m.create).toHaveBeenCalledTimes(1);
    m.count.mockResolvedValueOnce(CLAIM_LOOKUPS_PER_WINDOW);
    expect(await claimLookupLimited("ip-hash")).toBe(true);
    expect(m.create).toHaveBeenCalledTimes(1);
  });
});
