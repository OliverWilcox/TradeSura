import { badgePublic } from "@/lib/verification-state";

// The public Verified Member badge is Muhammad's rule (badgePublic: live, a
// read card, the Gas Safe Register checked, not paused or banned). On top of
// it, the impersonation check (Matt 16 Nov): a name that isn't on the
// company's officer/PSC list keeps the badge, the town page and the Founding
// Member perks off until an admin clears the flag (lib/company-role-check.ts).
export type BadgeEngineer = Parameters<typeof badgePublic>[0] & { companyRoleFlaggedAt: Date | null };

export function showsVerifiedBadge(e: BadgeEngineer): boolean {
  return badgePublic(e) && !e.companyRoleFlaggedAt;
}

/** The Prisma filter matching showsVerifiedBadge, for queries. */
export const BADGE_WHERE = {
  gasSafeVerifiedAt: { not: null },
  gasSafeCardReadId: { not: null },
  gasSafeRegisterCheckedAt: { not: null },
  pausedAt: null,
  bannedAt: null,
  companyRoleFlaggedAt: null,
};
