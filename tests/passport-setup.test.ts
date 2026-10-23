// Retention §9 — the homeowner's Home Passport setup only fills blanks.
import { describe, expect, it } from "vitest";
import { MAX_BOILER_PHOTOS, fittedDate, homeownerBoilerPatch, passportNeedsSetup } from "@/lib/passport-setup";

const empty = { make: null, model: null, installedAt: null, photoUrls: [] as string[] };

describe("homeownerBoilerPatch", () => {
  it("fills every blank on an empty boiler", () => {
    const at = new Date(Date.UTC(2019, 4, 1));
    const { data, filled } = homeownerBoilerPatch(empty, { make: " Worcester ", model: "30i", installedAt: at, photoUrls: ["a"] });
    expect(data).toEqual({ make: "Worcester", model: "30i", installedAt: at, photoUrls: ["a"] });
    expect(filled).toEqual(["make", "model", "installedAt", "photos"]);
  });

  it("never overwrites what an engineer entered", () => {
    const existing = { make: "Baxi", model: "630", installedAt: new Date(Date.UTC(2015, 0, 1)), photoUrls: ["e1"] };
    const { data, filled } = homeownerBoilerPatch(existing, {
      make: "Ideal",
      model: "Logic",
      installedAt: new Date(Date.UTC(2020, 0, 1)),
    });
    expect(data).toEqual({});
    expect(filled).toEqual([]);
  });

  it("treats whitespace as blank", () => {
    const { data } = homeownerBoilerPatch({ ...empty, make: "  " }, { make: "Vaillant" });
    expect(data.make).toBe("Vaillant");
  });

  it("appends photos up to the limit and skips duplicates", () => {
    const existing = { ...empty, photoUrls: ["e1", "e2", "e3"] };
    const { data } = homeownerBoilerPatch(existing, { photoUrls: ["e1", "n1", "n2"] });
    expect(data.photoUrls).toEqual(["e1", "e2", "e3", "n1"]);
    expect(data.photoUrls).toHaveLength(MAX_BOILER_PHOTOS);
    const full = homeownerBoilerPatch({ ...empty, photoUrls: ["1", "2", "3", "4"] }, { photoUrls: ["n"] });
    expect(full.filled).toEqual([]);
  });
});

describe("passportNeedsSetup / fittedDate", () => {
  it("asks until there's a photo, make and model", () => {
    expect(passportNeedsSetup(null)).toBe(true);
    expect(passportNeedsSetup({ make: "Baxi", model: "630", installedAt: null, photoUrls: [] })).toBe(true);
    expect(passportNeedsSetup({ make: "Baxi", model: null, installedAt: null, photoUrls: ["p"] })).toBe(true);
    expect(passportNeedsSetup({ make: "Baxi", model: "630", installedAt: null, photoUrls: ["p"] })).toBe(false);
  });

  it("builds a fitted date from month and year, rejecting the future", () => {
    const now = new Date(Date.UTC(2026, 9, 23));
    expect(fittedDate(2019, 5, now)?.toISOString()).toBe("2019-05-01T00:00:00.000Z");
    expect(fittedDate(2019, null, now)?.toISOString()).toBe("2019-01-01T00:00:00.000Z");
    expect(fittedDate(2026, 12, now)).toBeNull();
    expect(fittedDate(1900, 1, now)).toBeNull();
    expect(fittedDate(null, 3, now)).toBeNull();
  });
});
