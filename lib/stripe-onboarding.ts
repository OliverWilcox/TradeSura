// Stripe Connect onboarding: one account per engineer, pre-filled, never reset.
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import {
  belongsToAnotherPlatform,
  ensureRecipientConfiguration,
  getOrCreateConnectAccount,
  prefillConnectAccount,
} from "@/lib/stripe";

// The engineer's connected account, created (pre-filled) on first use and
// topped up after. Shared with /api/stripe/prepare, which the Get paid
// screen calls on open so "Continue to Stripe" only waits for the link.
export async function ensureConnectAccount(engineerId: string): Promise<string> {
  let engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  if (engineer.stripeAccountId) {
    try {
      // Merchant-only accounts from before the recipient fix pick it up here,
      // so the link below collects whatever transfers still needs.
      await ensureRecipientConfiguration(engineer.stripeAccountId);
    } catch (err) {
      if (!belongsToAnotherPlatform(err)) throw err;
      // Saved under an earlier test platform (the key has since changed), so
      // this key can't see it. Nothing can be charged through it — start
      // payment setup again on a fresh account.
      engineer = await prisma.engineer.update({
        where: { id: engineerId },
        data: {
          stripeAccountId: null,
          stripeDetailsSubmitted: false,
          stripeChargesEnabled: false,
          stripePayoutsEnabled: false,
        },
      });
    }
  }
  const accountId = await getOrCreateConnectAccount(engineer);
  if (accountId !== engineer.stripeAccountId) {
    await prisma.engineer.update({
      where: { id: engineerId },
      data: { stripeAccountId: accountId },
    });
    await track("stripe_account_created", { type: "ENGINEER", id: engineerId }, { accountId });
  } else if (!engineer.stripeChargesEnabled) {
    // Build Review 3 — never reset: the same account carries on where the
    // engineer stopped. Accounts made before the pre-fill get whatever we
    // know filled in now (best-effort; never overwrites their answers).
    await prefillConnectAccount(accountId, engineer);
  }

  return accountId;
}

