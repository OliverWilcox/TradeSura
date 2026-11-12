-- Matt, 4 Nov: letter batches uploaded from the admin. Each code is a real
-- reserved record before posting, with the date its Founding place is held
-- until and, back office only, where the letter goes. Additive only.

-- AlterTable
ALTER TABLE "ClaimCode" ADD COLUMN     "reservedUntil" DATE,
ADD COLUMN     "mailingAddress" TEXT;

-- CreateIndex
CREATE INDEX "ClaimCode_letterBatch_idx" ON "ClaimCode"("letterBatch");
