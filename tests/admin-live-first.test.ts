import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const { businessKey, checksOf, gasSafeNumbers, stageOf } = await import("@/lib/admin/verifications");
const { codeStem } = await import("@/lib/referral-code");

// Matt, 4 Nov: live first, register check behind; two Gas Safe numbers; the
// duplicate check's business name; short referral codes.

const none = {
  gasSafeNo: "1234567",
  gasSafeCardUrl: "https://x.public.blob.vercel-storage.com/card.jpg",
  gasSafeCardExpiresOn: null,
  gasSafeVerifiedAt: null,
  gasSafeRejectedAt: null,
  gasSafeRegisterCheckedAt: null,
  gasSafeSuspendedAt: null,
  gasSafeRecheckRequestedAt: null,
};
const now = new Date("2026-11-05T12:00:00Z");
const day = (d: string) => new Date(`${d}T09:00:00Z`);

describe("the check's stages", () => {
  it("waits for a card, then the card check, then the register check behind it", () => {
    expect(stageOf({ ...none, gasSafeNo: null }, now)).toBe("not_submitted");
    expect(stageOf({ ...none, gasSafeCardUrl: null }, now)).toBe("no_card");
    expect(checksOf(none, now)).toEqual({ stage: "card", card: "waiting", register: null });
    expect(checksOf({ ...none, gasSafeVerifiedAt: day("2026-11-05") }, now)).toEqual({ stage: "register", card: "passed", register: "due" });
    expect(checksOf({ ...none, gasSafeVerifiedAt: day("2026-11-05"), gasSafeRegisterCheckedAt: day("2026-11-05") }, now)).toEqual({ stage: "passed", card: "passed", register: "passed" });
  });

  it("is due a re-check two weeks after the card expires, or when one is asked for", () => {
    const passed = { ...none, gasSafeVerifiedAt: day("2025-11-01"), gasSafeRegisterCheckedAt: day("2025-11-01") };
    expect(stageOf({ ...passed, gasSafeCardExpiresOn: new Date("2026-10-30") }, now)).toBe("passed");
    expect(stageOf({ ...passed, gasSafeCardExpiresOn: new Date("2026-10-20") }, now)).toBe("recheck");
    expect(checksOf({ ...passed, gasSafeCardExpiresOn: new Date("2027-10-20"), gasSafeRecheckRequestedAt: now }, now).register).toBe("recheck_due");
  });

  it("tells a failed card check from a suspension, and keeps showing the suspension while a new card waits", () => {
    expect(checksOf({ ...none, gasSafeRejectedAt: now }, now)).toEqual({ stage: "card_failed", card: "failed", register: null });
    expect(checksOf({ ...none, gasSafeRejectedAt: now, gasSafeSuspendedAt: now }, now)).toEqual({ stage: "suspended", card: "passed", register: "suspended" });
    expect(checksOf({ ...none, gasSafeSuspendedAt: now }, now)).toEqual({ stage: "card", card: "waiting", register: "suspended" });
  });
});

describe("gasSafeNumbers", () => {
  it("keeps the licence and the registration number apart, reading an older single number by its length", () => {
    expect(gasSafeNumbers({ gasSafeNo: "1234567", gasSafeRegistrationNo: "584123" })).toEqual({ licenceNo: "1234567", registrationNo: "584123" });
    expect(gasSafeNumbers({ gasSafeNo: "584123", gasSafeRegistrationNo: null })).toEqual({ licenceNo: null, registrationNo: "584123" });
    expect(gasSafeNumbers({ gasSafeNo: null, gasSafeRegistrationNo: null })).toEqual({ licenceNo: null, registrationNo: null });
  });
});

describe("businessKey", () => {
  it("treats Smith Heating Ltd, SMITH HEATING LIMITED and Smith-Heating as one business", () => {
    expect(businessKey("Smith Heating Ltd")).toBe("smithheating");
    expect(businessKey("SMITH HEATING LIMITED")).toBe("smithheating");
    expect(businessKey("Smith-Heating")).toBe("smithheating");
    expect(businessKey("Ltd")).toBeNull();
    expect(businessKey(null)).toBeNull();
  });
});

describe("codeStem", () => {
  it("takes the surname (its first part, up to ten letters), else the business name", () => {
    expect(codeStem({ lastName: "Smith", tradingName: "Smith Heating", legalName: null })).toBe("SMITH");
    expect(codeStem({ lastName: "O'Brien-Hughes", tradingName: null, legalName: null })).toBe("OBRIEN");
    expect(codeStem({ lastName: "Wilkinson-Lockman", tradingName: null, legalName: null })).toBe("WILKINSON");
    expect(codeStem({ lastName: "Mueller", tradingName: null, legalName: null })).toBe("MUELLER");
    expect(codeStem({ lastName: "Featherstonehaugh", tradingName: null, legalName: null })).toBe("FEATHERSTO");
    expect(codeStem({ lastName: null, tradingName: "302 MD Ltd", legalName: null })).toBe("MD");
    expect(codeStem({ lastName: null, tradingName: null, legalName: null })).toBe("TS");
  });
});
