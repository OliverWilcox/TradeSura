// 30 Oct update §6 — "the app does the selling": the per-reason content the
// customer sees, its split-test pick, the pre-selected plan and benefit order.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { visitReasonContent: { findMany: vi.fn(async () => []) } } }));

import { checkWording } from "@/lib/compliance/blocklist";
import {
  VISIT_REASONS,
  defaultContent,
  fillFollowUp,
  orderBenefits,
  pickVariant,
  preselectedTierId,
  reasonList,
} from "@/lib/visit-reasons";
import { CLAUSE_TEMPLATES } from "@/lib/clauses";

describe("default visit-reason content", () => {
  it("ships the five reasons from Matt's working list, in order", async () => {
    expect((await reasonList()).map((r) => r.label)).toEqual([
      "New boiler fitted",
      "Breakdown / repair",
      "Yearly service",
      "Landlord safety check",
      "Other work",
    ]);
  });

  it("keeps every customer-facing line inside the plan-wording rules", () => {
    for (const reason of VISIT_REASONS) {
      const c = defaultContent(reason);
      for (const line of [c.headline, ...c.worries, ...c.messages, c.followUp2d, c.followUp7d]) {
        expect(checkWording(line), `${reason}: ${line}`).toEqual({ ok: true });
      }
    }
  });

  it("only orders benefits by clause codes that exist", () => {
    const codes = new Set(CLAUSE_TEMPLATES.map((c) => c.code));
    for (const reason of VISIT_REASONS) {
      for (const code of defaultContent(reason).benefitOrder) expect(codes.has(code), `${reason}: ${code}`).toBe(true);
    }
  });

  it("every follow-up text carries the customer's link", () => {
    for (const reason of VISIT_REASONS) {
      const c = defaultContent(reason);
      for (const t of [c.followUp2d, c.followUp7d]) expect(t).toContain("{link}");
    }
  });
});

describe("pickVariant", () => {
  const rows = [
    { variant: "A", weight: 1 },
    { variant: "B", weight: 1 },
  ];

  it("is stable for the same offer", () => {
    expect(pickVariant(rows, "tok-1")).toEqual(pickVariant(rows, "tok-1"));
  });

  it("splits roughly by weight", () => {
    const counts = { A: 0, B: 0 };
    for (let i = 0; i < 2000; i++) counts[pickVariant(rows, `t${i}`)!.variant as "A" | "B"] += 1;
    expect(counts.A).toBeGreaterThan(850);
    expect(counts.B).toBeGreaterThan(850);
  });

  it("never picks a switched-off variant, and none means the defaults", () => {
    expect(pickVariant([{ variant: "A", weight: 0 }, { variant: "B", weight: 3 }], "x")!.variant).toBe("B");
    expect(pickVariant([{ variant: "A", weight: 0 }], "x")).toBeNull();
  });
});

describe("preselectedTierId", () => {
  const three = [
    { id: "service", landlord: false },
    { id: "care", landlord: false },
    { id: "complete", landlord: false },
  ];

  it("with 3 plans the middle one, unless the reason says otherwise", () => {
    expect(preselectedTierId(three, "middle")).toBe("care");
    expect(preselectedTierId(three, "top")).toBe("complete");
    expect(preselectedTierId(three, "first")).toBe("service");
  });

  it("a landlord visit picks the landlord plan, and falls back to the middle without one", () => {
    expect(preselectedTierId([...three, { id: "landlord", landlord: true }], "landlord")).toBe("landlord");
    expect(preselectedTierId(three, "landlord")).toBe("care");
  });

  it("homeowner picks ignore the landlord plan", () => {
    expect(preselectedTierId([{ id: "care", landlord: false }, { id: "landlord", landlord: true }], "top")).toBe("care");
  });
});

describe("orderBenefits and fillFollowUp", () => {
  it("moves the reason's benefits first and keeps the rest in order", () => {
    const lines = ["ANNUAL_SERVICE", "PRIORITY_48H", "NO_CALLOUT_FEE", "CO_ALARM_TEST"].map((code) => ({ code }));
    expect(orderBenefits(lines, ["NO_CALLOUT_FEE", "PRIORITY_48H"]).map((l) => l.code)).toEqual([
      "NO_CALLOUT_FEE",
      "PRIORITY_48H",
      "ANNUAL_SERVICE",
      "CO_ALARM_TEST",
    ]);
  });

  it("fills the text and never sends one without the link", () => {
    const v = { first: "Pat", engineer: "Smith Heating", link: "https://tradesura.com/smith" };
    expect(fillFollowUp("Hi {first}, {engineer} here: {link}", v)).toBe("Hi Pat, Smith Heating here: https://tradesura.com/smith");
    expect(fillFollowUp("Hi {first}", v)).toBe("Hi Pat https://tradesura.com/smith");
  });
});
