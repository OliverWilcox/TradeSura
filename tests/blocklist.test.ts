import { describe, expect, it } from "vitest";
import { checkWording } from "@/lib/compliance/blocklist";

describe("wording blocklist", () => {
  const blocked = [
    "We fix any breakdown free",
    "Breakdowns covered",
    "break-down callouts",
    "All repairs included",
    "free repairs whenever you need",
    "repairs are free",
    "we will fix your boiler",
    "we'll fix it same day",
    "guaranteed response in 24 hours",
    "guaranteed fix or your money back",
    "cheaper than boiler insurance",
    "covered for breakdowns all year",
    // Build Guide v2 Part 18
    "Satisfaction guarantee on every visit",
    "Guaranteed to keep you warm",
    "24-hour emergency response",
    "emergency call-outs included",
    // Review 3 P0 — the bypasses
    "BoilerCover",
    "Boiler-Cover",
    "B.o.i.l.e.r C.o.v.e.r",
    "B0iler C0ver",
    "Boiler Covers",
    "Total Kover",
    "Home Insurence",
    "Brakedown Plan",
    "Emergancy Care",
    "Gu@ranteed Care",
    "In$urance",
    "1nsurance",
    "Emergency Plan",
  ];
  for (const text of blocked) {
    it(`blocks: "${text}"`, () => {
      const r = checkWording(text);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.explanation).toContain("insurance product");
        expect(r.suggestion.title).toBeTruthy();
      }
    });
  }

  const allowed = [
    "Annual boiler service",
    "Priority booking within 48 hours",
    "No call-out fees",
    "15% off labour",
    "We aim to attend quickly",
    "Fixed monthly price", // "fixed" is not "we will fix"
    "Landlord gas safety record",
    "Discover Care",
    "Recovery Plan",
    "Boiler Care",
    "Service + Priority",
    "Landlord Care",
    "Make sure your boiler is serviced",
  ];
  for (const text of allowed) {
    it(`allows: "${text}"`, () => {
      expect(checkWording(text).ok).toBe(true);
    });
  }
});

// Build Review 3 follow-up — the "you set the rate" boxes are free text on
// the customer's page, so they pass the word filter too.
describe("rateWordingError", () => {
  it("blocks insurance wording in a rate and allows a plain rate", async () => {
    const { rateWordingError } = await import("@/lib/plan-rules");
    expect(rateWordingError({ MULTI_APPLIANCE: "10% off" })).toBeNull();
    const err = rateWordingError({ MULTI_APPLIANCE: "10% off + breakdown cover" });
    expect(err?.code).toBe("rate_blocked");
  });
});
