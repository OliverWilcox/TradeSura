// Matt, 30 Oct §9.3 — the payout timeline's real dates.
import { describe, expect, it } from "vitest";
import { addWorkingDays, fridayOnOrAfter, payoutTimeline, shortDay } from "@/lib/payout-timeline";

const at = (s: string) => new Date(`${s}T10:00:00Z`);

describe("payout timeline", () => {
  it("a new engineer's first customer: cooling-off, Bacs, the 7-day hold, then Friday", () => {
    const t = payoutTimeline({ joinedAt: at("2026-11-02"), now: at("2026-11-02") });
    expect(t).toEqual({
      joinedAt: "2026-11-02",
      coolingOffEndsAt: "2026-11-16",
      firstCollectionAt: "2026-11-16",
      clearsAt: "2026-11-19",
      payoutAt: "2026-11-27",
    });
  });

  it("once they've been paid, the next Friday after the Bacs payment clears", () => {
    const t = payoutTimeline({ joinedAt: at("2026-11-02"), holdDays: 0, now: at("2026-11-02") });
    expect(t.clearsAt).toBe("2026-11-19");
    expect(t.payoutAt).toBe("2026-11-20");
  });

  it("uses the plan's real first collection date when it's known", () => {
    const t = payoutTimeline({ joinedAt: at("2026-11-02"), firstCollectionAt: at("2026-12-16"), now: at("2026-11-02") });
    expect(t.firstCollectionAt).toBe("2026-12-16");
  });

  it("skips weekends and bank holidays for Bacs, and a bank-holiday Friday pays the next working day", () => {
    expect(addWorkingDays(at("2026-12-23"), 3).toISOString().slice(0, 10)).toBe("2026-12-30");
    const t = payoutTimeline({ joinedAt: at("2026-12-09"), holdDays: 0, now: at("2026-12-09") });
    expect(t.firstCollectionAt).toBe("2026-12-23");
    expect(t.payoutAt).toBe("2027-01-04");
  });

  it("a payout date already gone rolls on to the coming Friday", () => {
    const t = payoutTimeline({ joinedAt: at("2026-09-01"), now: at("2026-11-02") });
    expect(t.payoutAt).toBe("2026-11-06");
  });

  it("formats dates the way Home shows them", () => {
    expect(fridayOnOrAfter(at("2026-11-27")).toISOString().slice(0, 10)).toBe("2026-11-27");
    expect(shortDay("2026-11-27")).toBe("Fri 27 Nov");
  });
});
