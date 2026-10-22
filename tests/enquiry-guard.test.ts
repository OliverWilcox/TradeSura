import { describe, expect, it } from "vitest";
import { MESSAGE_LIMIT_PER_HOUR, MIN_FILL_MS, enquiryFieldsError, enquirySpamVerdict, ipHash } from "@/lib/enquiries";

describe("enquiry spam guard", () => {
  const now = 1_800_000_000_000;
  const human = { honeypot: "", startedAt: now - 20_000, now, recentFromIp: 0 };

  it("lets a person through", () => {
    expect(enquirySpamVerdict(human)).toEqual({ ok: true });
  });

  it("silently drops bots that fill the hidden field", () => {
    expect(enquirySpamVerdict({ ...human, honeypot: "http://spam.example" })).toEqual({
      ok: false,
      reason: "honeypot",
      silent: true,
    });
  });

  it("silently drops forms sent faster than a person can type", () => {
    expect(enquirySpamVerdict({ ...human, startedAt: now - (MIN_FILL_MS - 1) })).toMatchObject({
      ok: false,
      reason: "too_fast",
    });
    expect(enquirySpamVerdict({ ...human, startedAt: now - MIN_FILL_MS })).toEqual({ ok: true });
  });

  it("rate limits per IP, and tells the person", () => {
    expect(enquirySpamVerdict({ ...human, recentFromIp: MESSAGE_LIMIT_PER_HOUR - 1 })).toEqual({ ok: true });
    expect(enquirySpamVerdict({ ...human, recentFromIp: MESSAGE_LIMIT_PER_HOUR })).toEqual({
      ok: false,
      reason: "rate_limited",
      silent: false,
    });
  });

  it("needs a name, a way to reply and a message", () => {
    const ok = { name: "Sarah Jones", phone: "07700 900123", email: "", message: "Boiler service in March please" };
    expect(enquiryFieldsError(ok)).toBeNull();
    expect(enquiryFieldsError({ ...ok, name: "" })).toMatch(/name/);
    expect(enquiryFieldsError({ ...ok, phone: "", email: "" })).toMatch(/phone number or email/);
    expect(enquiryFieldsError({ ...ok, phone: "", email: "sarah@example.com" })).toBeNull();
    expect(enquiryFieldsError({ ...ok, phone: "", email: "not-an-email" })).toMatch(/email/);
    expect(enquiryFieldsError({ ...ok, message: "hi" })).toMatch(/little/);
  });

  it("never stores the raw IP", () => {
    const h = ipHash("203.0.113.7");
    expect(h).not.toContain("203.0.113.7");
    expect(h).toBe(ipHash("203.0.113.7"));
    expect(h).not.toBe(ipHash("203.0.113.8"));
  });
});
