import { describe, expect, it } from "vitest";
import { addDays, daysBetween, ukDay, ukMidnight, weekStart } from "@/lib/admin/time";

// Admin reporting counts UK days and Monday–Sunday weeks, whatever the
// server's clock is set to.

describe("UK days for admin reporting", () => {
  it("start at midnight London time, in winter and in summer", () => {
    expect(ukMidnight("2026-01-15").toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(ukMidnight("2026-07-15").toISOString()).toBe("2026-07-14T23:00:00.000Z");
  });

  it("handle the days the clocks change", () => {
    expect(ukMidnight("2026-03-29").toISOString()).toBe("2026-03-29T00:00:00.000Z"); // clocks go forward at 01:00
    expect(ukMidnight("2026-03-30").toISOString()).toBe("2026-03-29T23:00:00.000Z");
    expect(ukMidnight("2026-10-25").toISOString()).toBe("2026-10-24T23:00:00.000Z"); // clocks go back at 02:00
    expect(ukMidnight("2026-10-26").toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("put a late-evening UTC time on the next UK day in summer", () => {
    expect(ukDay(new Date("2026-07-01T23:30:00Z"))).toBe("2026-07-02");
    expect(ukDay(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });

  it("refuse things that aren't days", () => {
    expect(() => ukMidnight("2026-02-30")).toThrow();
  });

  it("count weeks from Monday", () => {
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // a Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19"); // a Monday
  });

  it("step across months and list the days in a range", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });
});
