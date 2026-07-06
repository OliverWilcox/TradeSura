import { describe, expect, it } from "vitest";
import { nextAllowedSendTime } from "@/lib/sms";

function at(hours: number, minutes = 0) {
  const d = new Date(2026, 6, 6); // local time
  d.setHours(hours, minutes, 0, 0);
  return d;
}

describe("SMS quiet hours (20:00–08:00)", () => {
  it("daytime sends immediately", () => {
    const now = at(14, 30);
    expect(nextAllowedSendTime(now)).toEqual(now);
  });
  it("08:00 exactly is allowed", () => {
    const now = at(8, 0);
    expect(nextAllowedSendTime(now)).toEqual(now);
  });
  it("20:00 queues to 08:00 next day", () => {
    const next = nextAllowedSendTime(at(20, 0));
    expect(next.getHours()).toBe(8);
    expect(next.getDate()).toBe(7);
  });
  it("23:45 queues to 08:00 next day", () => {
    const next = nextAllowedSendTime(at(23, 45));
    expect(next.getHours()).toBe(8);
    expect(next.getDate()).toBe(7);
  });
  it("03:00 queues to 08:00 same day", () => {
    const next = nextAllowedSendTime(at(3, 0));
    expect(next.getHours()).toBe(8);
    expect(next.getDate()).toBe(6);
  });
});
