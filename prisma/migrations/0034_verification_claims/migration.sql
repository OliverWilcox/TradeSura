-- Admin API: who is checking a waiting Gas Safe application. New table only.
-- CreateTable
CREATE TABLE "VerificationClaim" (
    "engineerId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminName" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationClaim_pkey" PRIMARY KEY ("engineerId")
);

