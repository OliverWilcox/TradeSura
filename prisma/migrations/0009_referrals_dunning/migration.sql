-- E10 referrals + S2 dunning.

ALTER TABLE "Engineer" ADD COLUMN     "referrerId" TEXT,
ADD COLUMN     "referralBountyPaidAt" TIMESTAMP(3);

ALTER TABLE "Engineer" ADD CONSTRAINT "Engineer_referrerId_fkey"
  FOREIGN KEY ("referrerId") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Plan" ADD COLUMN "paymentFailedAt" TIMESTAMP(3);
