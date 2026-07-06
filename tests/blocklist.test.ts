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
  ];
  for (const text of allowed) {
    it(`allows: "${text}"`, () => {
      expect(checkWording(text).ok).toBe(true);
    });
  }
});
