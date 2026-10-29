// Review 4 — Remove customer is blocked while they're on a plan (their
// Direct Debit can't vanish with the record) or their home has a Home
// Passport (it stays with the property for the next owner). Shared with
// the app's own check so the button explains itself before it's tapped.
export function removeBlockedReason(c: {
  plans: { status: string }[];
  properties: { passportId: string | null }[];
}): string | null {
  if (c.plans.some((p) => p.status === "ACTIVE" || p.status === "PAUSED")) {
    return "They're on a plan, so they can't be removed. End their plan first, or text them the manage link.";
  }
  if (c.properties.some((p) => p.passportId)) {
    return "Their home has a Home Passport, which stays with the property, so they can't be removed.";
  }
  return null;
}
