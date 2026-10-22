import { describe, expect, it } from "vitest";
import {
  listedOnTownPage,
  townFromDistrict,
  townFromServiceArea,
  townIsPublic,
  townOrder,
  townSlugOf,
  type TownEngineer,
} from "@/lib/town";

// Section 6 — profile URLs are /gas-engineers/{town}/{slug}.
describe("town slug derivation", () => {
  it("slugs town names", () => {
    expect(townSlugOf("Huddersfield")).toBe("huddersfield");
    expect(townSlugOf("Stoke-on-Trent")).toBe("stoke-on-trent");
    expect(townSlugOf("St Albans")).toBe("st-albans");
    expect(townSlugOf("Brighton & Hove")).toBe("brighton-and-hove");
    expect(townSlugOf("Ynys Môn")).toBe("ynys-mon");
  });

  it("takes the first place named in the service area", () => {
    expect(townFromServiceArea("Huddersfield, Holmfirth and the Colne Valley")).toBe("Huddersfield");
    expect(townFromServiceArea("covering Leeds and Bradford")).toBe("Leeds");
    expect(townFromServiceArea("brighton, hove")).toBe("Brighton");
    expect(townFromServiceArea("stoke-on-trent")).toBe("Stoke-on-Trent");
    expect(townFromServiceArea("Ely")).toBe("Ely");
  });

  it("skips postcode districts and gives up when there's no place name", () => {
    expect(townFromServiceArea("HD1, HD2, HD9 and Holmfirth")).toBe("Holmfirth");
    expect(townFromServiceArea("HD1 · HD2 · HD3")).toBeNull();
    expect(townFromServiceArea("BN2 5")).toBeNull();
    expect(townFromServiceArea("")).toBeNull();
    expect(townFromServiceArea(null)).toBeNull();
  });

  it("tidies local authority names from postcode lookups", () => {
    expect(townFromDistrict("Kirklees")).toBe("Kirklees");
    expect(townFromDistrict("City of Edinburgh")).toBe("Edinburgh");
    expect(townFromDistrict("Brighton and Hove")).toBe("Brighton and Hove");
    expect(townFromDistrict(null)).toBeNull();
  });
});

describe("town publish rule", () => {
  const real: TownEngineer = {
    gasSafeVerifiedAt: new Date(),
    profilePublishedAt: new Date(),
    liveTiers: 1,
    leftAt: null,
    bannedAt: null,
    deletedAt: null,
    ownerId: null,
  };

  it("needs a verified engineer with a published profile and a live plan", () => {
    expect(listedOnTownPage(real)).toBe(true);
    expect(listedOnTownPage({ ...real, gasSafeVerifiedAt: null })).toBe(false);
    expect(listedOnTownPage({ ...real, profilePublishedAt: null })).toBe(false);
    expect(listedOnTownPage({ ...real, liveTiers: 0 })).toBe(false);
  });

  it("leaves out installers who left, banned, deleted accounts and staff", () => {
    expect(listedOnTownPage({ ...real, leftAt: new Date() })).toBe(false);
    expect(listedOnTownPage({ ...real, bannedAt: new Date() })).toBe(false);
    expect(listedOnTownPage({ ...real, deletedAt: new Date() })).toBe(false);
    expect(listedOnTownPage({ ...real, ownerId: "owner" })).toBe(false);
  });

  it("publishes a town only with a real engineer and never while held", () => {
    expect(townIsPublic(null, [real])).toBe(true);
    expect(townIsPublic({ heldAt: null }, [real])).toBe(true);
    expect(townIsPublic({ heldAt: new Date() }, [real])).toBe(false);
    expect(townIsPublic(null, [])).toBe(false);
    expect(townIsPublic(null, [{ ...real, liveTiers: 0 }])).toBe(false);
  });

  it("lists website partners higher, then by rating", () => {
    const rows = [
      { name: "HD Boiler Services", partner: false, average: 4.6, count: 9 },
      { name: "Colne Valley Gas", partner: false, average: 4.8, count: 21 },
      { name: "Dave's Heating", partner: true, average: 4.5, count: 38 },
      { name: "Pennine Heat", partner: false, average: null, count: 0 },
    ];
    expect(townOrder(rows).map((r) => r.name)).toEqual([
      "Dave's Heating",
      "Colne Valley Gas",
      "HD Boiler Services",
      "Pennine Heat",
    ]);
  });
});
