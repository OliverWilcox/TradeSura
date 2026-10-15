// Build Review 2, section 8 — a staff engineer's Gas Safe check, as the
// owner's Team page shows it. Staff can't send offers until it's verified.
export type StaffCheck = "check_in_progress" | "verified" | "rejected";

export function staffCheckStatus(s: {
  gasSafeVerifiedAt: Date | null;
  gasSafeRejectedAt: Date | null;
}): StaffCheck {
  if (s.gasSafeVerifiedAt) return "verified";
  if (s.gasSafeRejectedAt) return "rejected";
  return "check_in_progress";
}
