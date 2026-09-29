// One-off: add the recipient configuration (stripe_transfers) to every
// engineer's connected account created merchant-only after the v2 Accounts
// migration, then re-sync their status. Safe to run twice — both steps are
// idempotent. Run against the env whose DB + Stripe key you mean to fix:
//   npx tsx scripts/stripe-backfill-recipient.ts
import "dotenv/config";
import { prisma } from "../lib/db";
import { ensureRecipientConfiguration, getConnectAccountStatus } from "../lib/stripe";

async function main() {
  const engineers = await prisma.engineer.findMany({
    where: { stripeAccountId: { not: null } },
    select: { id: true, stripeAccountId: true },
  });
  for (const e of engineers) {
    const accountId = e.stripeAccountId!;
    try {
      await ensureRecipientConfiguration(accountId);
      const s = await getConnectAccountStatus(accountId);
      await prisma.engineer.update({
        where: { id: e.id },
        data: {
          stripeDetailsSubmitted: s.detailsSubmitted,
          stripeChargesEnabled: s.chargesEnabled,
          stripePayoutsEnabled: s.payoutsEnabled,
        },
      });
      console.log(`${accountId}: charges=${s.chargesEnabled} payouts=${s.payoutsEnabled}`);
    } catch (err) {
      console.error(`${accountId}: failed —`, err instanceof Error ? err.message : err);
    }
  }
}

main().finally(() => prisma.$disconnect());
