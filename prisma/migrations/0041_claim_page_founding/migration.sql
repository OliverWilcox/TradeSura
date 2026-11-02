-- 30 Oct update §1: what the claim page collects.
ALTER TABLE "ClaimCode" ADD COLUMN "town" TEXT,
  ADD COLUMN "claimedAt" TIMESTAMP(3),
  ADD COLUMN "tradingAddress" TEXT,
  ADD COLUMN "tradingTown" TEXT,
  ADD COLUMN "tradingTownSlug" TEXT,
  ADD COLUMN "correspondenceAddress" TEXT,
  ADD COLUMN "mobile" TEXT,
  ADD COLUMN "textConsentAt" TIMESTAMP(3),
  ADD COLUMN "codeTextedAt" TIMESTAMP(3);

-- 30 Oct update §10: when the account could first take sign-ups.
ALTER TABLE "Engineer" ADD COLUMN "accountCompletedAt" TIMESTAMP(3);

-- 30 Oct update §10: top-3 Founding spots per town.
CREATE TABLE "TopSpot" (
    "id" TEXT NOT NULL,
    "townSlug" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "heldFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopSpot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TopSpot_townSlug_releasedAt_idx" ON "TopSpot"("townSlug", "releasedAt");
CREATE INDEX "TopSpot_engineerId_idx" ON "TopSpot"("engineerId");
