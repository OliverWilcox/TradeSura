import { describe, it, expect } from "vitest";
import { removeBlockedReason } from "@/lib/customer-remove";

describe("Remove customer guard (Review 4)", () => {
  const none = { plans: [], properties: [] };
  it("allows a customer with no plan and no passport", () => expect(removeBlockedReason(none)).toBeNull());
  it("allows one whose offers never went live or ended", () =>
    expect(removeBlockedReason({ plans: [{ status: "PENDING" }, { status: "CANCELLED" }], properties: [] })).toBeNull());
  it("blocks while on a plan (Direct Debit)", () =>
    expect(removeBlockedReason({ plans: [{ status: "ACTIVE" }], properties: [] })).toMatch(/on a plan/));
  it("blocks while a plan is paused", () =>
    expect(removeBlockedReason({ plans: [{ status: "PAUSED" }], properties: [] })).toMatch(/on a plan/));
  it("blocks when the home has a Home Passport", () =>
    expect(removeBlockedReason({ plans: [], properties: [{ passportId: "hp_1" }] })).toMatch(/Home Passport/));
});
