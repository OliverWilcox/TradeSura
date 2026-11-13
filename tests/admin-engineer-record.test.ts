import { describe, expect, it } from "vitest";
import { CALL_LADDER, ladderStep } from "@/lib/admin/metrics";
import { nextRegisterCheck } from "@/lib/admin/verifications";
import { cardExpiry } from "@/lib/gas-safe-card";

// Engineer record 3 and 4: the follow-up ladder, the next register check, and
// the card expiry the app sends.

describe("ladderStep", () => {
  it("follows Matt's ladder of 4 Nov: day 3 push, day 5 WhatsApp, day 7 email, day 10 call list", () => {
    expect(ladderStep(2)).toBeNull();
    expect(ladderStep(3)?.label).toBe("Push");
    expect(ladderStep(4)?.step).toBe(1);
    expect(ladderStep(5)?.label).toBe("WhatsApp");
    expect(ladderStep(7)?.label).toBe("Email");
    expect(ladderStep(10)?.label).toBe("Call list");
    expect(ladderStep(365)).toBe(CALL_LADDER.at(-1));
  });
});

describe("nextRegisterCheck", () => {
  const checked = new Date("2026-03-15T10:00:00Z");

  it("is two weeks after the card's expiry, or a year after the last check without one", () => {
    expect(nextRegisterCheck(null, null)).toBeNull();
    expect(nextRegisterCheck(checked, null)).toEqual(new Date("2027-03-15T10:00:00Z"));
    expect(nextRegisterCheck(checked, new Date("2026-12-31"))).toEqual(new Date("2027-01-14"));
  });

  it("doesn't fall due again at once for a card that had already lapsed when it was checked", () => {
    expect(nextRegisterCheck(checked, new Date("2026-02-01"))).toEqual(new Date("2027-03-15T10:00:00Z"));
  });
});

describe("cardExpiry", () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const today = new Date();

  it("takes today or a later date, as a UTC date", () => {
    expect(cardExpiry.parse(iso(today))).toEqual(new Date(`${iso(today)}T00:00:00Z`));
    expect(cardExpiry.safeParse(iso(new Date(today.getTime() + 300 * 86_400_000))).success).toBe(true);
  });

  it("refuses a date that's passed, one years off, and anything not a date", () => {
    expect(cardExpiry.safeParse(iso(new Date(today.getTime() - 2 * 86_400_000))).success).toBe(false);
    expect(cardExpiry.safeParse(iso(new Date(today.getTime() + 6 * 365 * 86_400_000))).success).toBe(false);
    expect(cardExpiry.safeParse("2026-13-45").success).toBe(false);
    expect(cardExpiry.safeParse("31/12/2026").success).toBe(false);
  });
});
