-- Reversed Direct Debit payments and disputes on plan collections (30 Oct §9.6).
CREATE TABLE "PlanDispute" (
    "id" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "planId" TEXT,
    "engineerId" TEXT,
    "amountPence" INTEGER NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "reversedPence" INTEGER NOT NULL DEFAULT 0,
    "reversalId" TEXT,
    "returnedTransferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PlanDispute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanDispute_stripeDisputeId_key" ON "PlanDispute"("stripeDisputeId");
CREATE INDEX "PlanDispute_planId_idx" ON "PlanDispute"("planId");
CREATE INDEX "PlanDispute_engineerId_idx" ON "PlanDispute"("engineerId");
