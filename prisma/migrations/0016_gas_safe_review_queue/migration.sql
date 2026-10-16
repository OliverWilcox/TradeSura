-- 29 Sept review — Gas Safe verification goes through a human admin queue
-- (number + ID-card photo) instead of an automatic register match.
ALTER TABLE "Engineer" ADD COLUMN "gasSafeCardUrl" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "gasSafeRejectedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "gasSafeRejectReason" TEXT;
