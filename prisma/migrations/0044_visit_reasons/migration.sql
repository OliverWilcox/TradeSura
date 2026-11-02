-- 30 Oct update §6 — "the app does the selling": visit reasons, the
-- at-the-job offer session, and reviews that don't need a plan.
ALTER TABLE "Plan" ADD COLUMN "visitReason" TEXT,
ADD COLUMN "visitVariant" TEXT,
ADD COLUMN "offerSessionId" TEXT;

ALTER TABLE "Rating" ALTER COLUMN "planId" DROP NOT NULL,
ALTER COLUMN "serviceRecordId" DROP NOT NULL,
ADD COLUMN "source" TEXT NOT NULL DEFAULT 'service',
ADD COLUMN "offerSessionId" TEXT,
ADD COLUMN "contactPhone" TEXT,
ADD COLUMN "contactEmail" TEXT,
ADD COLUMN "offerConsent" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Rating_offerSessionId_key" ON "Rating"("offerSessionId");

CREATE TABLE "VisitReasonContent" (
    "id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'A',
    "weight" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "headline" TEXT NOT NULL,
    "worries" JSONB NOT NULL,
    "messages" JSONB NOT NULL,
    "graphicKey" TEXT,
    "benefitOrder" JSONB NOT NULL,
    "preselect" TEXT NOT NULL DEFAULT 'middle',
    "followUp2d" TEXT NOT NULL,
    "followUp7d" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitReasonContent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitReasonContent_reason_variant_key" ON "VisitReasonContent"("reason", "variant");

CREATE TABLE "OfferSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "soldById" TEXT,
    "reason" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'A',
    "channel" TEXT NOT NULL,
    "planId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OfferSession_token_key" ON "OfferSession"("token");
CREATE UNIQUE INDEX "OfferSession_planId_key" ON "OfferSession"("planId");
CREATE INDEX "OfferSession_engineerId_createdAt_idx" ON "OfferSession"("engineerId", "createdAt");
