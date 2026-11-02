import { describe, expect, it } from "vitest";
import { ACTIVE_WINDOW_DAYS, CALL_LADDER, ladderStep } from "@/lib/admin/metrics";
import { nextRegisterCheck } from "@/lib/admin/verifications";
import { cardExpiry } from "@/lib/gas-safe-card";

// Engineer record 3 and 4: the call ladder, the next register check, and the
// card expiry the app sends.

describe("ladderStep", () => {
  it("starts when an engineer stops being active and climbs from there", () => {
    expect(ladderStep(ACTIVE_WINDOW_DAYS - 1)).toBeNull();
    expect(ladderStep(7)?.label).toBe("Reminder text");
    expect(ladderStep(13)?.step).toBe(1);
    expect(ladderStep(14)?.label).toBe("First call");
    expect(ladderStep(21)?.label).toBe("Second call");
    expect(ladderStep(30)?.label).toBe("Final call");
    expect(ladderStep(365)).toBe(CALL_LADDER.at(-1));
  });
});

describe("nextRegisterCheck", () => {
  const verified = new Date("2026-03-15T10:00:00Z");

  it("is a year after verification, or sooner when the card expires first", () => {
    expect(nextRegisterCheck(null, null)).toBeNull();
    expect(nextRegisterCheck(verified, null)).toEqual(new Date("2027-03-15T10:00:00Z"));
    expect(nextRegisterCheck(verified, new Date("2026-12-31"))).toEqual(new Date("2026-12-31"));
    expect(nextRegisterCheck(verified, new Date("2028-01-01"))).toEqual(new Date("2027-03-15T10:00:00Z"));
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
