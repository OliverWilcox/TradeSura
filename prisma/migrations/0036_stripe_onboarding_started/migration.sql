-- When the engineer first taps "Continue to Stripe" (the account is now made
-- earlier, when Get paid opens). Existing accounts were only ever made from
-- that tap or before it, so they count as started.
ALTER TABLE "Engineer" ADD COLUMN "stripeOnboardingStartedAt" TIMESTAMP(3);
UPDATE "Engineer" SET "stripeOnboardingStartedAt" = CURRENT_TIMESTAMP WHERE "stripeAccountId" IS NOT NULL;
