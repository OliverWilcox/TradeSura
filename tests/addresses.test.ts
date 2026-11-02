import { describe, expect, it } from "vitest";
import { AddressInput, formatAddress, parseAddress, postcodeOf, sameAddress } from "@/lib/addresses";

// Engineer record 1: the trading address is kept on its own, and read from the
// pack address sign-up saved until it is.

describe("parseAddress", () => {
  it("splits sign-up's line, town and postcode", () => {
    expect(parseAddress("Unit 4, Holmfirth Mill\nHolmfirth\nHD9 2TT")).toEqual({ lines: ["Unit 4", "Holmfirth Mill"], town: "Holmfirth", postcode: "HD9 2TT" });
  });

  it("finds a postcode on the town's line and puts its space back", () => {
    expect(parseAddress("12 Station Road, Holmfirth hd92tt")).toEqual({ lines: ["12 Station Road"], town: "Holmfirth", postcode: "HD9 2TT" });
  });

  it("keeps every street line of a longer address (302 MD LTD's registered office)", () => {
    expect(parseAddress("Gateway Tower\n32 Western Gateway\nLondon\nE16 1YL")).toEqual({ lines: ["Gateway Tower", "32 Western Gateway"], town: "London", postcode: "E16 1YL" });
  });

  it("gives up without a postcode or a street line", () => {
    expect(parseAddress("12 Station Road\nHolmfirth")).toBeNull();
    expect(parseAddress("Holmfirth\nHD9 2TT")).toBeNull();
    expect(parseAddress(null)).toBeNull();
  });
});

describe("formatAddress", () => {
  it("writes the pack address the way sign-up does, and reads back the same", () => {
    const a = { lines: ["Unit 4"], town: "Holmfirth", postcode: "HD9 2TT" };
    expect(formatAddress(a)).toBe("Unit 4\nHolmfirth\nHD9 2TT");
    expect(parseAddress(formatAddress(a))).toEqual(a);
  });
});

describe("sameAddress and postcodeOf", () => {
  it("ignore case, spacing and punctuation", () => {
    expect(sameAddress("Unit 4\nHolmfirth\nHD9 2TT", "unit 4, holmfirth, hd92tt")).toBe(true);
    expect(sameAddress("Unit 4\nHolmfirth\nHD9 2TT", "Unit 5\nHolmfirth\nHD9 2TT")).toBe(false);
    expect(sameAddress(null, null)).toBe(false);
    expect(postcodeOf("Gateway Tower 32 Western Gateway, London, E16 1YL")).toBe("E161YL");
  });
});

describe("AddressInput", () => {
  it("drops blank street lines and normalises the postcode", () => {
    expect(AddressInput.parse({ lines: ["Unit 4", " ", ""], town: "Holmfirth", postcode: "hd92tt" })).toEqual({ lines: ["Unit 4"], town: "Holmfirth", postcode: "HD9 2TT" });
  });

  it("refuses an address with no street line, a bad postcode or a town with no letters", () => {
    expect(AddressInput.safeParse({ lines: [""], town: "Holmfirth", postcode: "HD9 2TT" }).success).toBe(false);
    expect(AddressInput.safeParse({ lines: ["Unit 4"], town: "Holmfirth", postcode: "HD9" }).success).toBe(false);
    expect(AddressInput.safeParse({ lines: ["Unit 4"], town: "--", postcode: "HD9 2TT" }).success).toBe(false);
  });
});
