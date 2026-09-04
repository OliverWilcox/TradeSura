-- Payments provider swap: GoCardless -> Stripe (Connect Express + Bacs subscriptions).

-- Engineer: drop GoCardless org tokens, add Stripe connected-account state.
DROP INDEX IF EXISTS "Engineer_gcOrganisationId_key";
ALTER TABLE "Engineer" DROP COLUMN "gcOrganisationId",
DROP COLUMN "gcAccessToken",
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Engineer_stripeAccountId_key" ON "Engineer"("stripeAccountId");

-- Customer: rename the provider customer id.
ALTER TABLE "Customer" DROP COLUMN "gcCustomerId",
ADD COLUMN     "stripeCustomerId" TEXT;

-- Plan: drop billing-request/mandate/subscription ids, add Stripe equivalents.
ALTER TABLE "Plan" DROP COLUMN "gcBillingRequestId",
DROP COLUMN "gcBillingRequestFlowId",
DROP COLUMN "gcMandateId",
DROP COLUMN "gcSubscriptionId",
ADD COLUMN     "stripeCheckoutSessionId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "mandateStatus" TEXT;

-- Webhook idempotency guard.
DROP TABLE "GcWebhookEvent";

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);
