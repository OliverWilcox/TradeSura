// Matt 16 Nov — impersonation check: the person's name against the company's
// officers and people with significant control.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  engineer: null as Record<string, unknown> | null,
  update: vi.fn(async () => ({})),
  track: vi.fn(),
  officers: vi.fn(),
  pscs: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: { engineer: { findUnique: vi.fn(async () => m.engineer), update: m.update } },
}));
vi.mock("@/lib/track", () => ({ track: m.track }));
vi.mock("@/lib/companies-house", () => ({ companyOfficers: m.officers, companyPscNames: m.pscs }));

import { personListed, runCompanyRoleCheck } from "@/lib/company-role-check";

describe("is the person on the company's lists?", () => {
  it("finds them among the officers or the PSCs, short names included", () => {
    expect(personListed({ officers: ["WOOD, Matthew Dean"], pscs: [] }, "Matt", "Wood")).toBe("listed");
    expect(personListed({ officers: ["SMITH, Jane"], pscs: ["Wood, Matthew"] }, "Matthew", "Wood")).toBe("listed");
  });
  it("says not listed only when both lists came back", () => {
    expect(personListed({ officers: ["SMITH, Jane"], pscs: ["Smith, Jane"] }, "Matt", "Wood")).toBe("not_listed");
    expect(personListed({ officers: ["SMITH, Jane"], pscs: null }, "Matt", "Wood")).toBeNull();
    expect(personListed({ officers: null, pscs: null }, "Matt", "Wood")).toBeNull();
  });
});

describe("the check at sign-up", () => {
  const now = new Date("2026-11-18T12:00:00Z");
  beforeEach(() => {
    vi.clearAllMocks();
    m.engineer = { businessType: "ltd", companyNumber: "12345678", firstName: "Matt", lastName: "Wood", ownerId: null, companyRoleFlaggedAt: null };
  });

  it("flags someone who isn't an officer or PSC", async () => {
    m.officers.mockResolvedValue([{ name: "SMITH, Jane", role: "director" }]);
    m.pscs.mockResolvedValue(["Smith, Jane"]);
    expect(await runCompanyRoleCheck("e1", now)).toBe("not_listed");
    expect(m.update).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { companyRoleCheck: "not_listed", companyRoleCheckedAt: now, companyRoleFlaggedAt: now },
    });
  });

  it("records a director without flagging them", async () => {
    m.officers.mockResolvedValue([{ name: "WOOD, Matthew Dean", role: "director" }]);
    m.pscs.mockResolvedValue([]);
    expect(await runCompanyRoleCheck("e1", now)).toBe("listed");
    expect(m.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { companyRoleCheck: "listed", companyRoleCheckedAt: now } });
  });

  it("never flags when Companies House can't answer", async () => {
    m.officers.mockResolvedValue(null);
    m.pscs.mockResolvedValue(null);
    expect(await runCompanyRoleCheck("e1", now)).toBeNull();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("skips sole traders and staff", async () => {
    m.engineer = { ...m.engineer!, businessType: "sole_trader" };
    expect(await runCompanyRoleCheck("e1", now)).toBeNull();
    m.engineer = { ...m.engineer!, businessType: "ltd", ownerId: "owner" };
    expect(await runCompanyRoleCheck("e1", now)).toBeNull();
    expect(m.officers).not.toHaveBeenCalled();
  });
});
