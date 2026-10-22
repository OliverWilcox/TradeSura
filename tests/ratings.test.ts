import { describe, expect, it } from "vitest";
import {
  averageStars,
  canRequestRating,
  isLowRating,
  isNewMember,
  isValidStars,
  publicCustomerName,
  replyError,
} from "@/lib/ratings";

// Section 5 — ratings rules.
describe("ratings", () => {
  it("takes whole stars from 1 to 5 only", () => {
    expect([1, 2, 3, 4, 5].every(isValidStars)).toBe(true);
    expect(isValidStars(0)).toBe(false);
    expect(isValidStars(6)).toBe(false);
    expect(isValidStars(4.5)).toBe(false);
    expect(isValidStars("5")).toBe(false);
  });

  it("asks only plan holders, after a logged service", () => {
    expect(canRequestRating({ kind: "service", planId: "plan_1" })).toBe(true);
    expect(canRequestRating({ kind: "service", planId: null })).toBe(false);
    expect(canRequestRating({ kind: "note", planId: "plan_1" })).toBe(false);
    expect(canRequestRating({ kind: "certificate", planId: "plan_1" })).toBe(false);
  });

  it("alerts on 1 or 2 stars", () => {
    expect(isLowRating(1)).toBe(true);
    expect(isLowRating(2)).toBe(true);
    expect(isLowRating(3)).toBe(false);
  });

  it("shows New to TradeSura until the threshold is reached", () => {
    expect(isNewMember(0, 3)).toBe(true);
    expect(isNewMember(2, 3)).toBe(true);
    expect(isNewMember(3, 3)).toBe(false);
  });

  it("averages to one decimal place and counts every rating, low ones included", () => {
    expect(averageStars([])).toBeNull();
    expect(averageStars([5, 5, 4])).toBe(4.7);
    expect(averageStars([5, 1])).toBe(3);
  });

  it("names the customer by first name and initial", () => {
    expect(publicCustomerName("Sarah", "Jones")).toBe("Sarah J.");
    expect(publicCustomerName("Sarah", "")).toBe("Sarah");
  });

  it("allows one public reply per rating, in plan-safe wording", () => {
    const rated = { reply: null, ratedAt: new Date() };
    expect(replyError(rated, "Thanks Sarah, see you next March!")).toBeNull();
    expect(replyError({ ...rated, reply: "Thanks!" }, "Another reply")).toMatch(/one reply/);
    expect(replyError({ reply: null, ratedAt: null }, "Thanks")).toMatch(/hasn't rated/);
    expect(replyError(rated, " ")).toMatch(/Write a reply/);
    expect(replyError(rated, "Don't worry, you're covered for breakdowns")).toMatch(/can't say/);
  });
});
