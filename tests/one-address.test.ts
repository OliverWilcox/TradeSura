// Review 4 — one address everywhere: tradesura.com/{slug}, each plan at
// /{slug}/{plan}, chosen once, old addresses kept.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/app-url", () => ({ appUrl: () => "https://tradesura.com" }));

import { planSlugs, tierForPlanSlug } from "@/lib/plan-slugs";
import { planLinkDisplay, planLinkUrl, profileUrl, signupUrl } from "@/lib/public-url";
import { RESERVED_SLUGS, moveSlug } from "@/lib/slug";

describe("plan links", () => {
  const tiers = [
    { id: "a", name: "Boiler Care" },
    { id: "b", name: "Landlord Care" },
    { id: "c", name: "Boiler care" },
    { id: "d", name: "Signup" },
  ];

  it("gives every plan its own link, so Landlord Care no longer shares Boiler Care's", () => {
    const s = planSlugs(tiers);
    expect(s.get("a")).toBe("boiler-care");
    expect(s.get("b")).toBe("landlord-care");
    expect(s.get("c")).toBe("boiler-care-2");
    expect(s.get("d")).toBe("signup-2");
  });

  it("finds the plan a link names, ignoring case", () => {
    expect(tierForPlanSlug(tiers, "Landlord-Care")?.id).toBe("b");
    expect(tierForPlanSlug(tiers, "gone")).toBeNull();
  });

  it("builds every link off the one address", () => {
    expect(profileUrl("mwheating")).toBe("https://tradesura.com/mwheating");
    expect(planLinkUrl("mwheating")).toBe("https://tradesura.com/mwheating");
    expect(planLinkUrl("mwheating", "boiler-care")).toBe("https://tradesura.com/mwheating/boiler-care");
    expect(planLinkDisplay("mwheating", "boiler-care")).toBe("tradesura.com/mwheating/boiler-care");
    expect(signupUrl("mwheating", "tok")).toBe("https://tradesura.com/mwheating/signup/tok");
  });
});

describe("the address itself", () => {
  it("keeps the app's own words", () => {
    for (const w of ["login", "admin", "help", "join", "api", "c", "p", "gas-engineers"]) expect(RESERVED_SLUGS.has(w)).toBe(true);
  });

  it("keeps the old address when it moves, without duplicates", () => {
    expect(moveSlug({ slug: "302-md-ltd", previousSlugs: [] }, "mdheating")).toEqual({
      slug: "mdheating",
      previousSlugs: ["302-md-ltd"],
    });
    // Moving back to an old address takes it off the old list.
    expect(moveSlug({ slug: "mdheating", previousSlugs: ["302-md-ltd"] }, "302-md-ltd")).toEqual({
      slug: "302-md-ltd",
      previousSlugs: ["mdheating"],
    });
    expect(moveSlug({ slug: "same", previousSlugs: ["x"] }, "same")).toEqual({ slug: "same" });
  });
});
