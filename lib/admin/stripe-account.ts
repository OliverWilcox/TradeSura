import { prisma } from "@/lib/db";
import { getPayoutSummary, getStripe, stripeConfigured, stripeDeadline, stripeSetupState } from "@/lib/stripe";
import { withTimeout } from "@/lib/admin/verifications";

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

const STRIPE_TIMEOUT_MS = 5_000;

export async function stripeLive(accountId: string | null, engineerId?: string) {
  if (!accountId || !stripeConfigured()) return null;
  try {
    const [account, payouts] = await Promise.all([
      withTimeout(getStripe().v2.core.accounts.retrieve(accountId, { include: ["requirements"] }), STRIPE_TIMEOUT_MS),
      withTimeout(getPayoutSummary(accountId), STRIPE_TIMEOUT_MS),
    ]);
    const deadline = account.requirements?.summary?.minimum_deadline;
    if (engineerId) {
      const at = deadline?.status === "currently_due" || deadline?.status === "past_due" ? stripeDeadline(deadline.time) : null;
      prisma.engineer.update({ where: { id: engineerId }, data: { stripeRequirementsDeadline: at } }).catch((err) => console.error("[admin-api] Stripe deadline not kept:", err));
    }
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
