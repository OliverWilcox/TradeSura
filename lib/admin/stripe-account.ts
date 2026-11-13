import { getPayoutSummary, getStripe, stripeConfigured, stripeSetupState } from "@/lib/stripe";
import { withTimeout } from "@/lib/admin/verifications";

// An engineer's Stripe set-up as the admin shows it (Matt, 4 Nov): stage 1 is
// Stripe's form (the details they give to start taking payments), stage 2 is
// whatever Stripe asks for after that, by Stripe's own deadline. From the
// app's own set-up states (lib/stripe.ts), so the admin and the app agree.

export type StripeStages = { stage1: "not_started" | "started" | "done"; stage2: "waiting" | "due" | "done" };

export function stripeStages(e: {
  stripeAccountId: string | null;
  stripeDetailsSubmitted: boolean;
  stripeChargesEnabled: boolean;
  stripePayoutsEnabled: boolean;
  stripeOnboardingStartedAt: Date | null;
}): StripeStages {
  const state = stripeSetupState(e);
  const stage1 = state === "none" ? "not_started" : state === "half" ? "started" : "done";
  return { stage1, stage2: stage1 !== "done" ? "waiting" : state === "ready" ? "done" : "due" };
}

/** Longest the record waits on Stripe before showing what it has without it. */
const STRIPE_TIMEOUT_MS = 5_000;

/**
 * What only Stripe knows, asked live for one engineer's record: the deadline
 * for what's due, and their balance and next payout. Null when Stripe isn't
 * set up here or didn't answer in time.
 */
export async function stripeLive(accountId: string | null) {
  if (!accountId || !stripeConfigured()) return null;
  try {
    const [account, payouts] = await Promise.all([
      withTimeout(getStripe().v2.core.accounts.retrieve(accountId, { include: ["requirements"] }), STRIPE_TIMEOUT_MS),
      withTimeout(getPayoutSummary(accountId), STRIPE_TIMEOUT_MS),
    ]);
    const deadline = account.requirements?.summary?.minimum_deadline;
    return {
      deadline: deadline ? { status: deadline.status, at: deadline.time ?? null } : null,
      pendingPence: payouts.pendingPence,
      availablePence: payouts.availablePence,
      nextPayout: payouts.nextPayout ? { amountPence: payouts.nextPayout.amountPence, arrivesOn: payouts.nextPayout.arrivalDate.slice(0, 10) } : null,
    };
  } catch (err) {
    console.error("[admin-api] Stripe account read failed:", err);
    return null;
  }
}
