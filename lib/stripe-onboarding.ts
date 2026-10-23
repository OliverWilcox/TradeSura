// Stripe Connect onboarding: one account per engineer, pre-filled, never reset.
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { sendPushNotification } from "@/lib/push";
import { sendEmail } from "@/lib/email";
import {
  type ConnectAccountStatus,
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


// Stripe can ask a finished account for more information later (a document,
// an updated address). Tell the engineer once per request and send them
// back to onboarding; the hub and Home already show the amber
// "Stripe needs one more thing" until it's done.
export async function alertIfStripeNeedsMore(
  engineer: { id: string; email: string | null; firstName: string | null; stripeDetailsSubmitted: boolean; stripeMoreInfoAlertedAt: Date | null },
  status: ConnectAccountStatus,
): Promise<void> {
  // Mid-onboarding is the "half set up" state, not a later request.
  const finished = engineer.stripeDetailsSubmitted || status.detailsSubmitted;
  if (!status.requirementsDue || !finished) {
    if (engineer.stripeMoreInfoAlertedAt) {
      await prisma.engineer.update({ where: { id: engineer.id }, data: { stripeMoreInfoAlertedAt: null } });
    }
    return;
  }
  if (engineer.stripeMoreInfoAlertedAt) return;
  // Claim the alert first so a webhook retry can't send it twice.
  const claimed = await prisma.engineer.updateMany({
    where: { id: engineer.id, stripeMoreInfoAlertedAt: null },
    data: { stripeMoreInfoAlertedAt: new Date() },
  });
  if (claimed.count === 0) return;
  await track("stripe_more_info_requested", { type: "ENGINEER", id: engineer.id }, {});
  await sendPushNotification(
    engineer.id,
    "Stripe needs one more thing",
    "Stripe has asked for a bit more information before it can keep paying you. It takes a minute.",
    { url: "/get-paid" },
  ).catch((err) => console.error("[stripe] more-info push failed:", err));
  if (engineer.email) {
    await sendEmail({
      to: engineer.email,
      subject: "Stripe needs one more thing",
      html: `<p>Hi ${engineer.firstName ?? "there"},</p>
<p>Stripe has asked for a bit more information before it can keep paying you. It usually takes a minute.</p>
<p>Open the TradeSura app and tap <b>Get paid</b> to finish it. Your customers' plans aren't affected while you do.</p>`,
    }).catch((err) => console.error("[stripe] more-info email failed:", err));
  }
}
