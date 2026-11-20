import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { companyOfficers, companyPscNames } from "@/lib/companies-house";
import { matchPersonName } from "@/lib/admin/names";

// Matt 16 Nov — impersonation check. Anyone can pick any Ltd from Companies
// House at sign-up and tick "I'm the only owner", so the person's name is
// checked against that company's current officers and people with
// significant control. Not on either list → flagged for a person to look at,
// and the account is limited until they clear it: no Verified Member badge,
// no town page, no Founding Member spot (lib/public-badge.ts, lib/founding.ts).
// Companies House not answering is never a flag — the admin queue still shows
// the officers next to the name, as before.

export type CompanyRoleResult = "listed" | "not_listed";

/** Whether the person is among the company's officers or PSCs; null when Companies House can't say. */
export function personListed(
  names: { officers: string[] | null; pscs: string[] | null },
  firstName: string | null,
  lastName: string | null,
): CompanyRoleResult | null {
  const all = [...(names.officers ?? []), ...(names.pscs ?? [])];
  if (all.some((n) => matchPersonName(n, firstName, lastName) !== "none")) return "listed";
  // Only say "not listed" when both lists actually came back.
  if (names.officers === null || names.pscs === null) return null;
  return "not_listed";
}

/** Runs the check for a limited company's account. Safe to call twice; never throws. */
export async function runCompanyRoleCheck(engineerId: string, now = new Date()): Promise<CompanyRoleResult | null> {
  try {
    const e = await prisma.engineer.findUnique({
      where: { id: engineerId },
      select: { businessType: true, companyNumber: true, firstName: true, lastName: true, ownerId: true, companyRoleFlaggedAt: true },
    });
    // Staff join a business that was already checked; sole traders have no company.
    if (!e || e.ownerId || e.businessType !== "ltd" || !e.companyNumber) return null;
    const [officers, pscs] = await Promise.all([
      companyOfficers(e.companyNumber).then((o) => (o ? o.map((x) => x.name) : null)).catch(() => null),
      companyPscNames(e.companyNumber).catch(() => null),
    ]);
    const result = personListed({ officers, pscs }, e.firstName, e.lastName);
    if (!result) {
      await track("company_role_checked", { type: "SYSTEM" }, { engineerId, outcome: "unavailable" });
      return null;
    }
    await prisma.engineer.update({
      where: { id: engineerId },
      data: {
        companyRoleCheck: result,
        companyRoleCheckedAt: now,
        // A flag an admin already set stays as it was; a listed name never
        // clears one an admin is still looking at.
        ...(result === "not_listed" && !e.companyRoleFlaggedAt ? { companyRoleFlaggedAt: now } : {}),
      },
    });
    await track("company_role_checked", { type: "SYSTEM" }, { engineerId, outcome: result, companyNumber: e.companyNumber });
    return result;
  } catch (err) {
    console.error("[company-role-check] failed:", err);
    return null;
  }
}
