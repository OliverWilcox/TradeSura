-- Review #18 terms versioning + #13 duplicate Gas Safe number guard.

ALTER TABLE "Plan" ADD COLUMN     "termsVersion" TEXT,
ADD COLUMN     "termsAgreedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Engineer_gasSafeNo_key" ON "Engineer"("gasSafeNo");
