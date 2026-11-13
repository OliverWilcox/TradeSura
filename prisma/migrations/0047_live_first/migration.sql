-- Matt, 4 Nov: live first, register check behind; the business registration
-- number beside the engineer's licence number; short referral codes. Additive only.

-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "gasSafeRegistrationNo" TEXT,
ADD COLUMN     "gasSafeRegisterCheckedAt" TIMESTAMP(3),
ADD COLUMN     "gasSafeSuspendedAt" TIMESTAMP(3),
ADD COLUMN     "gasSafeRecheckRequestedAt" TIMESTAMP(3),
ADD COLUMN     "gasSafeRecheckReason" TEXT,
ADD COLUMN     "referralCode" TEXT;

-- Engineers already live keep a null register check, so each is checked once
-- on the live register: earlier approvals could have leant on the stored copy.

-- CreateIndex
CREATE UNIQUE INDEX "Engineer_referralCode_key" ON "Engineer"("referralCode");
