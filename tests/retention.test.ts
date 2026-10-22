import { describe, expect, it } from "vitest";
import {
  WARRANTY_LINE,
  beforeYouGo,
  inEngineerArea,
  nextWinterDate,
  offerForReason,
  paidSoFarPence,
  postcodeDistrict,
  valueSummary,
  winbackBody,
} from "@/lib/retention";

const tiers = [
  { id: "basic", name: "Service Only", priceMonthlyPence: 900 },
  { id: "mid", name: "Boiler Care Lite", priceMonthlyPence: 1000 },
  { id: "care", name: "Boiler Care", priceMonthlyPence: 1200 },
  { id: "top", name: "Complete", priceMonthlyPence: 2200 },
];

// Retention spec, section 2 — one tailored offer per reason.
describe("offer by reason", () => {
  it("too expensive: the closest cheaper live plan from the same engineer", () => {
    const offer = offerForReason("too_expensive", { currentPricePence: 1200, currentTierId: "care", liveTiers: tiers });
    expect(offer).toEqual({ kind: "cheaper_plan", tier: tiers[1], savingPence: 200 });
  });

  it("too expensive with nothing cheaper: pause instead", () => {
    const offer = offerForReason("too_expensive", { currentPricePence: 900, currentTierId: "basic", liveTiers: tiers });
    expect(offer).toEqual({ kind: "pause" });
  });

  it("moving house: move the plan", () => {
    expect(offerForReason("moving", { currentPricePence: 1200, currentTierId: "care", liveTiers: tiers }).kind).toBe("move_plan");
  });

  it("not using it: show what's included", () => {
    expect(offerForReason("not_using", { currentPricePence: 1200, currentTierId: "care", liveTiers: tiers }).kind).toBe("show_value");
  });

  it("unhappy or something else: pause for 1 or 2 months", () => {
    for (const r of ["unhappy", "other"] as const) {
      expect(offerForReason(r, { currentPricePence: 1200, currentTierId: "care", liveTiers: tiers }).kind).toBe("pause");
    }
  });
});

const clauses = [
  { code: "ANNUAL_SERVICE", title: "Annual boiler service" },
  { code: "PRIORITY_48H", title: "Priority booking" },
  { code: "NO_CALLOUT_FEE", title: "No call-out fee" },
  { code: "LABOUR_DISCOUNT_10", title: "10% off any repairs" },
];

describe("Before you go figures", () => {
  it("paid so far = cleared payments × price (yearly is 12 for 11)", () => {
    expect(paidSoFarPence({ paymentsCleared: 7, priceMonthlyPence: 1200, billingInterval: "month" })).toBe(8400);
    expect(paidSoFarPence({ paymentsCleared: 1, priceMonthlyPence: 1200, billingInterval: "year" })).toBe(13200);
    expect(paidSoFarPence({ paymentsCleared: 0, priceMonthlyPence: 1200, billingInterval: "month" })).toBe(0);
  });

  it("service not used: warns they'll lose it, lists the rest", () => {
    const f = beforeYouGo({
      brand: "Dave's Heating",
      engineerFirstName: "Dave",
      since: new Date("2026-03-10T12:00:00Z"),
      paidPence: 8400,
      serviceUsed: false,
      clauses,
    });
    expect(f.paidLine).toBe("You've paid £84 into your plan with Dave's Heating since March.");
    expect(f.serviceLine).toBe("Your annual service (worth £80) hasn't been used yet. If you cancel now, you'll lose it.");
    expect(f.loseLines).toEqual(["Priority booking with Dave", "No call-out fee", "10% off any repairs"]);
  });

  it("service used: swaps the line for what they've had", () => {
    const f = beforeYouGo({
      brand: "Dave's Heating",
      engineerFirstName: "Dave",
      since: null,
      paidPence: 8400,
      serviceUsed: true,
      clauses: [clauses[0], clauses[3]],
    });
    expect(f.serviceLine).toBe("You've had your service (worth £80), plus 10% off any repairs, all for £84.");
  });

  it("no annual service on the plan: no service line", () => {
    const f = beforeYouGo({ brand: "X", engineerFirstName: null, since: null, paidPence: 0, serviceUsed: false, clauses: [clauses[1]] });
    expect(f.serviceLine).toBeNull();
  });

  it("the warranty line credits the service, not the plan", () => {
    expect(WARRANTY_LINE).toMatch(/yearly service to keep your warranty valid/);
    expect(WARRANTY_LINE).not.toMatch(/plan|guarantee|cover|protection|insurance/i);
  });
});

describe("moving: is the new home in the engineer's area", () => {
  it("reads the postcode district", () => {
    expect(postcodeDistrict("hd1 4ab")).toBe("HD1");
    expect(postcodeDistrict("SW1A 1AA")).toBe("SW1A");
    expect(postcodeDistrict("nonsense")).toBeNull();
  });

  it("matches a district or area named in the service area", () => {
    expect(inEngineerArea({ newPostcode: "HD7 5AB", engineerPostcode: null, serviceArea: "Huddersfield, HD1-HD9" })).toBe(false);
    expect(inEngineerArea({ newPostcode: "HD7 5AB", engineerPostcode: null, serviceArea: "HD7, HD8 and WF postcodes" })).toBe(true);
    expect(inEngineerArea({ newPostcode: "WF1 2AA", engineerPostcode: null, serviceArea: "HD7, HD8 and WF postcodes" })).toBe(true);
  });

  it("falls back to the engineer's own postcode area", () => {
    expect(inEngineerArea({ newPostcode: "HD7 5AB", engineerPostcode: "HD1 1AA", serviceArea: null })).toBe(true);
    expect(inEngineerArea({ newPostcode: "LS1 1AA", engineerPostcode: "HD1 1AA", serviceArea: null })).toBe(false);
  });
});

describe("retention texts", () => {
  it("before winter is the next 1 October", () => {
    expect(nextWinterDate(new Date("2026-12-14T10:00:00Z")).toISOString()).toBe("2027-10-01T09:00:00.000Z");
    expect(nextWinterDate(new Date("2026-08-01T10:00:00Z")).toISOString()).toBe("2026-10-01T09:00:00.000Z");
  });

  it("win-back uses the engineer's offer", () => {
    const body = winbackBody({ firstName: "Sarah", brand: "Dave's Heating", offer: "first_month_free", link: "L", winter: false });
    expect(body).toBe("Hi Sarah, it's Dave's Heating. We miss looking after your boiler. Rejoin and get your first month free: L");
  });

  it("price rise notice says what they've had", () => {
    expect(valueSummary({ monthsOnPlan: 12, servicesDone: 1 })).toBe("In 12 months on your plan, you've had 1 service.");
    expect(valueSummary({ monthsOnPlan: 1, servicesDone: 0 })).toBe("In 1 month on your plan, your annual service is still to come.");
  });
});
