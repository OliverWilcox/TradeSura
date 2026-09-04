-- C5: letter-campaign claim codes.
CREATE TABLE "ClaimCode" (
    "code" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "letterBatch" TEXT NOT NULL,
    "variantCell" TEXT NOT NULL,
    "suppressedAt" TIMESTAMP(3),
    "redeemedByEngineerId" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimCode_pkey" PRIMARY KEY ("code")
);

CREATE UNIQUE INDEX "ClaimCode_redeemedByEngineerId_key" ON "ClaimCode"("redeemedByEngineerId");
