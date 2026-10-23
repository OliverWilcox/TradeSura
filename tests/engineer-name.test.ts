import { describe, expect, it } from "vitest";
import { brandName, perMonth, tradingNameOf } from "@/lib/engineer";
import { COMPANY_LINE, emailShell, withCompanyFooter } from "@/lib/email-layout";

describe("engineer names (Build Review 3, section 2)", () => {
  it("says when a trading name differs from the legal name", () => {
    expect(tradingNameOf({ tradingName: "MW Heating", legalName: "TRADESURA LTD", slug: "mw" })).toBe(
      "MW Heating is a trading name of Tradesura Ltd",
    );
  });

  it("stays quiet when they're the same name, or there's no legal name", () => {
    expect(tradingNameOf({ tradingName: "Smith Heating Ltd", legalName: "SMITH HEATING LIMITED", slug: "s" })).toBeNull();
    expect(tradingNameOf({ tradingName: "Smith Heating", legalName: null, slug: "s" })).toBeNull();
  });

  it("falls back to the legal name, then the slug", () => {
    expect(brandName({ tradingName: " ", legalName: "TRADESURA LTD", slug: "x" })).toBe("TRADESURA LTD");
    expect(brandName({ tradingName: null, slug: "x" })).toBe("x");
  });
});

describe("VAT wording (R5)", () => {
  it("adds 'a month including VAT' only for a VAT-registered engineer", () => {
    expect(perMonth("£15", true, "/mo")).toBe("£15 a month including VAT");
    expect(perMonth("£15", false, "/mo")).toBe("£15/mo");
    expect(perMonth("£15", false)).toBe("£15 a month");
  });
});

describe("company footer on every email", () => {
  it("adds the footer to plain emails once", () => {
    const html = withCompanyFooter("<p>Hi</p>");
    expect(html).toContain("company no. 17325346");
    expect(withCompanyFooter(html).split("17325346").length).toBe(2);
  });

  it("emailShell already carries it, with an absolute logo URL", () => {
    const html = emailShell({ title: "t", preheader: "p", rows: "" });
    expect(html).toContain(COMPANY_LINE);
    expect(html).toMatch(/<img src="https:\/\/[^"]+\/brand\/lockup\.png"/);
    expect(withCompanyFooter(html)).toBe(html);
  });
});

describe("companyDisplayName", () => {
  it("turns a Companies House name into normal casing, keeping initials", async () => {
    const { companyDisplayName } = await import("@/lib/engineer");
    expect(companyDisplayName("TRADESURA LTD")).toBe("Tradesura Ltd");
    expect(companyDisplayName("MW HEATING SERVICES LTD")).toBe("MW Heating Services Ltd");
    expect(companyDisplayName("Smith & Sons Ltd")).toBe("Smith & Sons Ltd");
  });
});
