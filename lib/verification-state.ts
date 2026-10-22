// Build Guide v2 Part 6.4 LAW — "one truth source read by the strip,
// Payouts' banner, and the Account status card." Priority ladder when
// several are true, worst first: banned > paused > Stripe-needs-info >
// check-failed > check-pending > active. Every string is verbatim from
// Part 6.4's table / Part 18.
export type StandingState =
  | "BANNED"
  | "PAUSED"
  | "STRIPE_NEEDS_INFO"
  | "CHECK_FAILED"
  | "CHECK_PENDING"
  | "ACTIVE";

export type StandingTone = "amber" | "red" | "quiet";

export type EngineerVerification = {
  bannedAt: Date | null;
  banReason: string | null;
  pausedAt: Date | null;
  pauseReason: string | null;
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
  gasSafeNo: string | null;
  gasSafeVerifiedAt: Date | null;
  gasSafeReviewRequestedAt: Date | null;
  gasSafeRejectedAt: Date | null;
  gasSafeRejectReason: string | null;
};

export function standingState(e: EngineerVerification): StandingState {
  if (e.bannedAt) return "BANNED";
  if (e.pausedAt) return "PAUSED";
  if (e.stripeAccountId && e.stripeDetailsSubmitted && !e.stripeChargesEnabled) {
    return "STRIPE_NEEDS_INFO";
  }
  // Build Guide v2 review 17 Sept, B1 — "Home shows 'Gas Safe verified —
  // account active' ... but the account is NOT verified." The bug: this
  // function's old shape checked each *unverified* state one at a time and
  // fell through to ACTIVE by default — so any engineer record that didn't
  // happen to match one of those specific patterns (e.g. a legacy row with
  // gasSafeReviewRequestedAt already cleared some other way, or any future
  // state this function doesn't yet know about) silently read as verified.
  // gasSafeStatus() below never had this bug — it checks the one thing that
  // actually means "verified" (gasSafeVerifiedAt) FIRST, and only reads as
  // ACTIVE when that's genuinely true; everything else is a form of "not
  // verified yet." This function now works the same way, so the two can
  // never again disagree the way Home and Account just did.
  if (e.gasSafeVerifiedAt) return "ACTIVE";
  // 29 Sept review — "shows the FAILURE state on a fresh account that never
  // submitted anything". Failed now means a reviewer actually rejected it
  // (app/admin/verifications); anything else unverified is still in the
  // queue, so it reads as pending. Still never ACTIVE without a real
  // gasSafeVerifiedAt above.
  if (e.gasSafeRejectedAt) return "CHECK_FAILED";
  return "CHECK_PENDING";
}

// Build Guide v2 Part 13 — the Account status card shows the Gas Safe and
// Payments facts as two independent lines (each in the same wording style
// the dashboard strip uses), rather than the strip's single collapsed
// priority-ladder value. Same truth source, same words, different shape.
export function gasSafeStatus(
  e: Pick<
    EngineerVerification,
    "gasSafeNo" | "gasSafeVerifiedAt" | "gasSafeReviewRequestedAt" | "gasSafeRejectedAt"
  >,
): { tone: StandingTone; text: string } {
  if (e.gasSafeVerifiedAt) return { tone: "quiet", text: "Gas Safe verified — account active." };
  if (e.gasSafeRejectedAt) {
    return {
      tone: "amber",
      text: "We couldn't verify your Gas Safe number — check it and try again →",
    };
  }
  return { tone: "amber", text: "Gas Safe check in progress — we'll let you know within 24 hours." };
}

export function paymentsStatus(
  e: Pick<
    EngineerVerification,
    "stripeAccountId" | "stripeDetailsSubmitted" | "stripeChargesEnabled"
  >,
): { tone: StandingTone; text: string } {
  if (e.stripeAccountId && e.stripeChargesEnabled) {
    return { tone: "quiet", text: "Payments — active, paid every Friday." };
  }
  if (e.stripeAccountId && e.stripeDetailsSubmitted) {
    return { tone: "amber", text: "Stripe needs more information to pay you — finish setup →" };
  }
  return { tone: "amber", text: "Set up payments →" };
}

export function standingCopy(
  e: EngineerVerification,
): { state: StandingState; tone: StandingTone; text: string } {
  const state = standingState(e);
  switch (state) {
    case "BANNED":
      return { state, tone: "red", text: e.banReason ?? "Your account is suspended — contact support." };
    case "PAUSED":
      return { state, tone: "red", text: e.pauseReason ?? "Your account is paused — Fix it →" };
    case "STRIPE_NEEDS_INFO":
      return { state, tone: "amber", text: "Stripe needs more information to pay you — finish setup →" };
    case "CHECK_FAILED":
      return {
        state,
        tone: "amber",
        text: "We couldn't verify your Gas Safe number — check it and try again →",
      };
    case "CHECK_PENDING":
      return { state, tone: "amber", text: "Gas Safe check in progress — we'll let you know within 24 hours." };
    case "ACTIVE":
      return { state, tone: "quiet", text: "Gas Safe verified — account active." };
    default: {
      // Exhaustiveness check, not a real fallback: standingState() above can
      // only return one of the 6 StandingState values, so this line never
      // actually runs. It exists so that adding a 7th state to the union
      // without adding its case here is a compile error, not a silently
      // wrong runtime default — B1's actual bug was exactly this shape of
      // "unhandled case quietly reads as verified," one layer down in
      // standingState() itself.
      const _exhaustive: never = state;
      throw new Error(`Unhandled StandingState: ${_exhaustive}`);
    }
  }
}

// Build Guide v2 Part 6.5 LAW — the two-leg gate: anything customer-facing
// needs a live plan AND the badge. The app greys these routes out; this is
// the server's own check so an old build or a direct call can't skip it.
// Returns the refusal message, or null when the engineer may send.
// Review 3 — the offer lock: real offers need the Gas Safe check AND
// payments set up (stripeChargesEnabled). Omitting the Stripe flag checks
// the badge only (callers that gate payments elsewhere).
export function offerBlockedReason(e: {
  gasSafeVerifiedAt: Date | null;
  pausedAt: Date | null;
  bannedAt: Date | null;
  stripeChargesEnabled?: boolean;
}): string | null {
  if (e.bannedAt || e.pausedAt) return "Your account is paused — check Account for what to do.";
  if (!e.gasSafeVerifiedAt) {
    return "Unlocks when your Gas Safe check is done (usually within 24 hours).";
  }
  if (e.stripeChargesEnabled === false) return "Set up payments first.";
  return null;
}
