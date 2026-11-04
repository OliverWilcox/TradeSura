import { describe, expect, it } from "vitest";
import { nextAllowedSendTime } from "@/lib/sms";

// London wall-clock time on 6 July 2026 (BST, an hour ahead of UTC).
function at(hours: number, minutes = 0) {
  return new Date(Date.UTC(2026, 6, 6, hours - 1, minutes));
}
const london = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

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
    expect(london(nextAllowedSendTime(at(20, 0)))).toBe("7, 08:00");
  });
  it("23:45 queues to 08:00 next day", () => {
    expect(london(nextAllowedSendTime(at(23, 45)))).toBe("7, 08:00");
  });
  it("03:00 queues to 08:00 same day", () => {
    expect(london(nextAllowedSendTime(at(3, 0)))).toBe("6, 08:00");
  });
});

// Matt, 4 Nov — London time whatever the server's clock (Vercel runs on UTC).
describe("quiet hours on London time", () => {
  it("8:30pm in summer (19:30 UTC) waits until 8am London (07:00 UTC)", () => {
    expect(nextAllowedSendTime(new Date("2026-07-06T19:30:00Z")).toISOString()).toBe("2026-07-07T07:00:00.000Z");
  });
  it("2:35am in winter waits until 8am that morning", () => {
    expect(nextAllowedSendTime(new Date("2026-11-04T02:35:00Z")).toISOString()).toBe("2026-11-04T08:00:00.000Z");
  });
  it("7:30am in summer (06:30 UTC) is still quiet", () => {
    expect(nextAllowedSendTime(new Date("2026-07-06T06:30:00Z")).toISOString()).toBe("2026-07-06T07:00:00.000Z");
  });
  it("7:30pm in winter goes straight away", () => {
    const now = new Date("2026-11-04T19:30:00Z");
    expect(nextAllowedSendTime(now)).toEqual(now);
  });
});
