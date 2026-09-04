-- Review #11 — manual-review escape hatch for a Gas Safe number that
-- didn't match the register at signup, so the engineer isn't dead-ended.
ALTER TABLE "Engineer" ADD COLUMN IF NOT EXISTS "gasSafeReviewRequestedAt" TIMESTAMP(3);
