-- Review 4 — one address per business, chosen once; old addresses redirect.
ALTER TABLE "Engineer" ADD COLUMN "slugChosenAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "previousSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "Engineer_previousSlugs_idx" ON "Engineer" USING GIN ("previousSlugs");
