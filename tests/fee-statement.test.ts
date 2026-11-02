// Matt, 30 Oct §9.5 — the monthly fee statement reconciles to the penny.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { isMonth, monthBounds, statementHtml, statementTotals, type Statement } from "@/lib/fee-statement";
import { computeApplicationFeePence } from "@/lib/stripe";

describe("fee statement", () => {
  it("each line's fee is Stripe's: 20% rounded down", () => {
    expect(computeApplicationFeePence(1599)).toBe(319);
    expect(computeApplicationFeePence(16500)).toBe(3300);
  });

  it("totals: fee, refunded fee and what reached the engineer", () => {
    const lines = [
      { date: "2 Nov 2026", customer: "Pat Hughes", planRef: "TSH-1001", collectedPence: 1599, feePence: 319 },
      { date: "9 Nov 2026", customer: "Sam Lee", planRef: "TSH-1002", collectedPence: 16500, feePence: 3300 },
    ];
    const refunds = [{ date: "20 Nov 2026", customer: "Sam Lee", planRef: "TSH-1002", refundedPence: 13750, feeRefundedPence: 2750 }];
    expect(statementTotals(lines, refunds)).toEqual({
      collectedPence: 18099,
      feePence: 3619,
      feeRefundedPence: 2750,
      netFeePence: 869,
      toYouPence: 18099 - 3619 - (13750 - 2750),
    });
  });

  it("months run on UK time", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(monthBounds("2026-07").start.toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(monthBounds("2026-11").start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(monthBounds("2026-12").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("the page says no VAT and escapes names", () => {
    const s: Statement = {
      month: "2026-11",
      number: "TS-202611-ABC123",
      issuedOn: "2 Dec 2026",
      engineer: { name: "Smith <Heating>", address: ["4 Mill Lane", "Brighton", "BN1 1AA"] },
      lines: [],
      refunds: [],
      totals: statementTotals([], []),
    };
    const html = statementHtml(s);
    expect(html).toContain("not VAT registered");
    expect(html).toContain("Smith &lt;Heating&gt;");
    expect(html).toContain("No collections this month.");
  });
});
