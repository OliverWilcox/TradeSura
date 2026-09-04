// Review #18: the customer checkout terms checkbox needs a versioned
// document behind it, recorded on the Plan when they agree — before that
// exists, "I agree to the plan terms" is a UI gesture with nothing behind
// it. This is a placeholder pending the solicitor's wording (CLAUDE.md
// targets 8 Sept 2026); bump CURRENT_TERMS_VERSION whenever the wording
// changes so old agreements stay attributable to what they actually saw.
export const CURRENT_TERMS_VERSION = "draft-2026-09-04";

export const TERMS_SUMMARY =
  "This is a maintenance-and-priority care plan with your engineer, not an insurance policy. " +
  "It renews monthly by Direct Debit, includes the services listed on your plan, and you can " +
  "cancel any time from your plan link. There's a 14-day cooling-off period from when you join. " +
  "Full solicitor-approved terms are coming soon — this summary is what you're agreeing to today.";
