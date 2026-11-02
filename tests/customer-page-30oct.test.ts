// 30 Oct update §5 and §7 — the value sum, the landlord price rule, which
// plan starts chosen, and the yearly-service block's order.
import { describe, expect, it } from "vitest";
import { planValuePence, valueSum } from "@/lib/value-sum";
import { landlordPriceError } from "@/lib/landlord-rule";
import { defaultTierId, hasLandlordChoice, tiersFor } from "@/lib/signup-choice";
import { orderedServiceReasons, serviceOrderForVisit, SERVICE_SHORT_LINE, WHY_YEARLY_SERVICE } from "@/lib/yearly-service";
import { detailsTexts } from "@/lib/details-request";
import { checkWording } from "@/lib/compliance/blocklist";

const prices = { normalServicePence: 9500, normalCalloutPence: 8500 };

describe("value sum (§7.3) — only the installer's own figures", () => {
  it("adds the service and the call-out only when the plan has them", () => {
    expect(planValuePence(["ANNUAL_SERVICE", "NO_CALLOUT_FEE"], prices)).toBe(18000);
    expect(planValuePence(["ANNUAL_SERVICE"], prices)).toBe(9500);
    expect(planValuePence(["PRIORITY_48H"], prices)).toBe(0);
    expect(planValuePence(["ANNUAL_SERVICE"], { normalServicePence: null, normalCalloutPence: null })).toBe(0);
  });

  it("says 'worth over' a figure below the real value, and the weekly cost rounded up", () => {
    // £180 of value against £12 a month (£144 a year, £2.77 a week).
    expect(valueSum(["ANNUAL_SERVICE", "NO_CALLOUT_FEE"], prices, 1200)).toEqual({ overPounds: 170, perWeek: "£2.77" });
  });

  it("says nothing when the plan costs as much as its items, or there are no figures", () => {
    expect(valueSum(["ANNUAL_SERVICE", "NO_CALLOUT_FEE"], prices, 1600)).toBeNull(); // £192 a year > £180
    expect(valueSum(["ANNUAL_SERVICE"], { normalServicePence: null, normalCalloutPence: null }, 1000)).toBeNull();
  });

  it("uses the yearly price when they pay yearly", () => {
    // £15 × 11 = £165 a year → £3.18 a week; value £180 → "over £170".
    expect(valueSum(["ANNUAL_SERVICE", "NO_CALLOUT_FEE"], prices, 1500, "year")).toEqual({ overPounds: 170, perWeek: "£3.18" });
  });
});

describe("landlord plans never give more for less (§7.4)", () => {
  const home = { id: "h", name: "Boiler Care", priceMonthlyPence: 1600, codes: ["ANNUAL_SERVICE", "PRIORITY_48H"] };
  const landlord = { id: "l", name: "Landlord Care", priceMonthlyPence: 1500, codes: ["ANNUAL_SERVICE", "PRIORITY_48H", "CP12"] };

  it("refuses a landlord plan that contains a homeowner plan and costs less", () => {
    expect(landlordPriceError(landlord, [home])).toMatch(/Landlord Care includes everything in Boiler Care, so it can't cost less/);
  });
  it("refuses raising the homeowner plan above the landlord plan that contains it", () => {
    expect(landlordPriceError(home, [landlord])).toMatch(/so Boiler Care can't cost more than Landlord Care/);
  });
  it("allows it at the same price or more, or when the landlord plan doesn't contain the other", () => {
    expect(landlordPriceError({ ...landlord, priceMonthlyPence: 1600 }, [home])).toBeNull();
    expect(landlordPriceError({ ...landlord, codes: ["ANNUAL_SERVICE", "CP12"] }, [home])).toBeNull();
  });
});

describe("which plan starts chosen (§7.4)", () => {
  const t = (id: string, price: number, extra: Partial<{ isRecommended: boolean; landlord: boolean }> = {}) => ({
    id,
    priceMonthlyPence: price,
    isRecommended: false,
    landlord: false,
    ...extra,
  });

  it("with 3 plans, the middle one by price", () => {
    expect(defaultTierId([t("a", 2000), t("b", 1000), t("c", 1500)])).toBe("c");
  });
  it("a named plan, then the visit reason's, then 'Most chosen' win over the middle", () => {
    const three = [t("a", 1000), t("b", 1500, { isRecommended: true }), t("c", 2000)];
    expect(defaultTierId(three, { initialTierId: "c" })).toBe("c");
    expect(defaultTierId(three, { reasonTierId: "a" })).toBe("a");
    expect(defaultTierId(three)).toBe("b");
    expect(defaultTierId([t("a", 1000), t("b", 2000)])).toBe("a");
  });
  it("asks 'Are you a landlord?' only with both kinds of plan, and filters by the answer", () => {
    const mixed = [t("h", 1000), t("l", 1600, { landlord: true })];
    expect(hasLandlordChoice(mixed)).toBe(true);
    expect(tiersFor(mixed, true).map((x) => x.id)).toEqual(["l"]);
    expect(hasLandlordChoice([t("h", 1000)])).toBe(false);
    expect(tiersFor([t("h", 1000)], true).map((x) => x.id)).toEqual(["h"]);
  });
});

describe("Why a yearly service matters (§7.6)", () => {
  it("has Matt's four lines and orders them by visit reason", () => {
    expect(WHY_YEARLY_SERVICE.map((r) => r.title)).toEqual([
      "Keeps you covered",
      "Keeps you safe",
      "Helps keep bills down",
      "Fewer nasty surprises",
    ]);
    expect(orderedServiceReasons(serviceOrderForVisit("breakdown"))[0].key).toBe("surprises");
    expect(orderedServiceReasons(serviceOrderForVisit("unknown")).map((r) => r.key)).toEqual(
      WHY_YEARLY_SERVICE.map((r) => r.key),
    );
  });
  it("the short version is the safe warranty wording", () => {
    expect(SERVICE_SHORT_LINE).toMatch(/keeps your boiler safe, efficient and your warranty valid\.$/);
  });
});

describe("Send me the details texts (§7.7)", () => {
  it("carry the link every time and pass the plan-wording filter", () => {
    const texts = detailsTexts({ first: "Pat", brand: "Smith Heating", link: "https://tradesura.com/smith/boiler-care" });
    for (const body of Object.values(texts)) {
      expect(body).toContain("https://tradesura.com/smith/boiler-care");
      expect(checkWording(body).ok, body).toBe(true);
    }
  });
});
