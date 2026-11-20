// Matt, 13 Nov — the engineer unlocks (You're live, offers) once the card
// check passes, but the public Verified Member badge (profile, plan pages,
// customer sign-up, website widget, town pages) waits until the Gas Safe
// Register check is marked passed in the admin. A failed check suspends the
// account (the admin clears gasSafeVerifiedAt), which takes the badge down too.
export type BadgeEngineer = {
  gasSafeVerifiedAt: Date | null;
  gasSafeRegisterCheckedAt: Date | null;
  gasSafeSuspendedAt?: Date | null;
  pausedAt?: Date | null;
  bannedAt?: Date | null;
  /** Matt 16 Nov — not on the company's officer/PSC list, until an admin clears it. */
  companyRoleFlaggedAt: Date | null;
};

export function showsVerifiedBadge(e: BadgeEngineer): boolean {
  return Boolean(
    e.gasSafeVerifiedAt &&
      e.gasSafeRegisterCheckedAt &&
      !e.gasSafeSuspendedAt &&
      !e.pausedAt &&
      !e.bannedAt &&
      !e.companyRoleFlaggedAt,
  );
}

/** The Prisma filter matching showsVerifiedBadge's register part, for queries. */
export const BADGE_WHERE = {
  gasSafeVerifiedAt: { not: null },
  gasSafeRegisterCheckedAt: { not: null },
  gasSafeSuspendedAt: null,
  companyRoleFlaggedAt: null,
};
