import { afterEach, describe, expect, it, vi } from "vitest";
import { businessTypeMismatch, companyProfile, formatOffice } from "@/lib/admin/companies";

// 3.4: "Test Trading LTD" signed up as a sole trader.

describe("a business's name and type", () => {
  it("flag a company name on a sole trader, and a limited company without one", () => {
    expect(businessTypeMismatch({ tradingName: "Test Trading LTD", legalName: null, businessType: "sole_trader" })).toBe("name_says_company");
    expect(businessTypeMismatch({ tradingName: "Smith & Co. Limited", legalName: null, businessType: "partnership" })).toBe("name_says_company");
    expect(businessTypeMismatch({ tradingName: "Acme plc", legalName: null, businessType: "sole_trader" })).toBe("name_says_company");
    expect(businessTypeMismatch({ tradingName: "Smith Heating", legalName: "SMITH HEATING", businessType: "ltd" })).toBe("type_says_company");
  });

  it("let them agree, and leave a trading name without Ltd alone when the registered name has it", () => {
    expect(businessTypeMismatch({ tradingName: "302 MD LTD", legalName: "302 MD LTD", businessType: "ltd" })).toBeNull();
    expect(businessTypeMismatch({ tradingName: "Hartley Boilers", legalName: "HARTLEY HEATING LIMITED", businessType: "ltd" })).toBeNull();
    expect(businessTypeMismatch({ tradingName: "Dave's Gas", legalName: null, businessType: "sole_trader" })).toBeNull();
    expect(businessTypeMismatch({ tradingName: "Jones LLP", legalName: null, businessType: "partnership" })).toBeNull();
    // "Ltd" inside a word isn't the word.
    expect(businessTypeMismatch({ tradingName: "Saltdean Plumbing", legalName: null, businessType: "sole_trader" })).toBeNull();
  });
});

describe("Companies House", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads a company's registered office", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "test-key");
    vi.stubGlobal("fetch", async () =>
      Response.json({
        company_number: "12345678",
        company_name: "302 MD LTD",
        type: "ltd",
        company_status: "active",
        registered_office_address: { premises: "Gateway Tower", address_line_1: "32 Western Gateway", locality: "London", postal_code: "E16 1YL" },
      }),
    );
    expect(await companyProfile("12345678")).toEqual({ number: "12345678", name: "302 MD LTD", type: "ltd", status: "active", registeredOffice: "Gateway Tower 32 Western Gateway, London, E16 1YL" });
  });

  it("answers null without a key, rather than guessing", async () => {
    vi.stubEnv("COMPANIES_HOUSE_API_KEY", "");
    expect(await companyProfile("12345678")).toBeNull();
    expect(formatOffice(undefined)).toBeNull();
  });
});
