import { describe, expect, it } from "vitest";
import {
  addMonths,
  addressKey,
  boilerAgeYears,
  computePassportState,
  isUkPostcode,
  passportLeads,
  repairLeadKeyword,
} from "@/lib/passport";

// Section 4 — one passport per address, shared by every plan there.
describe("addressKey", () => {
  it("matches the same home written differently", () => {
    const a = addressKey({ addressLine1: "12 Oak Road", postcode: "HD1 2AB" });
    expect(addressKey({ addressLine1: "12 oak rd.", postcode: "hd12ab" })).toBe(a);
    expect(addressKey({ addressLine1: "  12,  Oak   ROAD ", postcode: " HD1  2AB " })).toBe(a);
    expect(a).toBe("HD12AB|12 oak rd");
  });

  it("keeps flats and different houses apart", () => {
    const flat1 = addressKey({ addressLine1: "Flat 1, 12 Oak Road", postcode: "HD1 2AB" });
    const flat2 = addressKey({ addressLine1: "Flat 2, 12 Oak Road", postcode: "HD1 2AB" });
    const house = addressKey({ addressLine1: "14 Oak Road", postcode: "HD1 2AB" });
    expect(new Set([flat1, flat2, house]).size).toBe(3);
  });

  it("keeps the same street in a different postcode apart", () => {
    expect(addressKey({ addressLine1: "12 Oak Road", postcode: "HD1 2AB" })).not.toBe(
      addressKey({ addressLine1: "12 Oak Road", postcode: "HD2 2AB" }),
    );
  });

  it("rejects placeholder postcodes", () => {
    expect(isUkPostcode("HD1 2AB")).toBe(true);
    expect(isUkPostcode("sw1a1aa")).toBe(true);
    expect(isUkPostcode("—")).toBe(false);
    expect(isUkPostcode("12345")).toBe(false);
  });
});

describe("passport state", () => {
  const now = new Date("2026-10-23T12:00:00Z");

  it("is LIVE with any active plan, even alongside cancelled ones", () => {
    expect(computePassportState([{ status: "CANCELLED" }, { status: "ACTIVE" }], now)).toBe("LIVE");
    expect(computePassportState([{ status: "PAUSED" }], now)).toBe("LIVE");
  });

  it("is FROZEN with no active plan", () => {
    expect(computePassportState([], now)).toBe("FROZEN");
    expect(computePassportState([{ status: "CANCELLED" }, { status: "PENDING" }], now)).toBe("FROZEN");
  });

  it("freezes once a requested cancellation takes effect", () => {
    const ending = { status: "ACTIVE", cancelEffectiveAt: new Date("2026-11-14T00:00:00Z") };
    expect(computePassportState([ending], now)).toBe("LIVE");
    expect(computePassportState([ending], new Date("2026-11-15T00:00:00Z"))).toBe("FROZEN");
  });
});

describe("passport leads", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const consent = new Date("2026-01-01T00:00:00Z");

  it("counts boiler age in whole years", () => {
    expect(boilerAgeYears(new Date("2014-10-24T00:00:00Z"), now)).toBe(11);
    expect(boilerAgeYears(new Date("2014-10-23T00:00:00Z"), now)).toBe(12);
  });

  it("flags a boiler 12+ years old as a replacement lead", () => {
    const leads = passportLeads({ contactConsentAt: consent, boilerInstalledAt: new Date("2012-05-01"), ownNotes: [], now });
    expect(leads.map((l) => l.kind)).toEqual(["replacement"]);
  });

  it("turns repair words in a note into a repair lead", () => {
    expect(repairLeadKeyword("Pump getting noisy, keep an eye on it")).toBe("noisy");
    expect(repairLeadKeyword("Small leak on the PRV")).toBe("leak");
    expect(repairLeadKeyword("All fine")).toBeNull();
  });

  it("never turns gas-safety words into a lead — those go to the interlock", () => {
    expect(repairLeadKeyword("Customer reported a gas leak, noisy pump too")).toBeNull();
    expect(repairLeadKeyword("Smell of gas near the meter")).toBeNull();
    expect(repairLeadKeyword("fumes from the flue")).toBeNull();
  });

  it("shows nothing without the homeowner's consent", () => {
    expect(
      passportLeads({ contactConsentAt: null, boilerInstalledAt: new Date("2000-01-01"), ownNotes: ["noisy pump"], now }),
    ).toEqual([]);
  });

  it("defaults next due to twelve months on", () => {
    expect(addMonths(new Date("2026-03-12T10:00:00Z"), 12).toISOString()).toBe("2027-03-12T10:00:00.000Z");
  });
});
