// Matt, 13 Nov — the engineer unlocks once the card check passes, but the
// public Verified Member badge waits for the register check in the admin.
import { describe, expect, it } from "vitest";
import { showsVerifiedBadge } from "@/lib/public-badge";

const checked = { gasSafeVerifiedAt: new Date(), gasSafeRegisterCheckedAt: new Date(), gasSafeSuspendedAt: null, pausedAt: null, bannedAt: null, companyRoleFlaggedAt: null };

describe("the public Verified Member badge", () => {
  it("shows once the card check and the register check have both passed", () => {
    expect(showsVerifiedBadge(checked)).toBe(true);
  });
  it("waits while only the card check has passed", () => {
    expect(showsVerifiedBadge({ ...checked, gasSafeRegisterCheckedAt: null })).toBe(false);
  });
  it("comes down when suspended, paused or banned", () => {
    expect(showsVerifiedBadge({ ...checked, gasSafeVerifiedAt: null, gasSafeSuspendedAt: new Date() })).toBe(false);
    expect(showsVerifiedBadge({ ...checked, gasSafeSuspendedAt: new Date() })).toBe(false);
    expect(showsVerifiedBadge({ ...checked, pausedAt: new Date() })).toBe(false);
    expect(showsVerifiedBadge({ ...checked, bannedAt: new Date() })).toBe(false);
  });
  it("stays down while the impersonation check has them flagged (Matt, 16 Nov)", () => {
    expect(showsVerifiedBadge({ ...checked, companyRoleFlaggedAt: new Date() })).toBe(false);
  });
});
