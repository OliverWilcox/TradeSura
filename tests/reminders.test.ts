import { describe, expect, it } from "vitest";
import { nextServiceDate, REMINDER_OFFSETS_DAYS } from "@/lib/reminders";

describe("service reminders", () => {
  it("next service is one year on", () => {
    const d = nextServiceDate(new Date(2026, 6, 6));
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(6);
  });
  it("handles 29 Feb activation", () => {
    const d = nextServiceDate(new Date(2028, 1, 29));
    expect(d.getFullYear()).toBe(2029);
    expect(d.getMonth()).toBe(2); // rolls to 1 Mar — a day late beats a crash
  });
  it("cadence is 30/14/3 days", () => {
    expect([...REMINDER_OFFSETS_DAYS]).toEqual([30, 14, 3]);
  });
});
