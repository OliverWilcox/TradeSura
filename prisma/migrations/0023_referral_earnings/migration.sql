-- Build Review 2, ruling 4: affiliate commission ledger.
CREATE TABLE "ReferralEarning" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "feePence" INTEGER NOT NULL,
    "ratePercent" INTEGER NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "transferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralEarning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralEarning_invoiceId_key" ON "ReferralEarning"("invoiceId");
CREATE INDEX "ReferralEarning_referrerId_createdAt_idx" ON "ReferralEarning"("referrerId", "createdAt");

ALTER TABLE "ReferralEarning" ADD CONSTRAINT "ReferralEarning_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReferralEarning" ADD CONSTRAINT "ReferralEarning_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "Engineer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
