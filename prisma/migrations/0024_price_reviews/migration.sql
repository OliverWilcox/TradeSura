-- Build Review 2, ruling 3: annual price review notices.
CREATE TABLE "PriceReview" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "oldPence" INTEGER NOT NULL,
    "newPence" INTEGER NOT NULL,
    "noticeSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "PriceReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PriceReview_planId_idx" ON "PriceReview"("planId");
CREATE INDEX "PriceReview_effectiveAt_idx" ON "PriceReview"("effectiveAt");

ALTER TABLE "PriceReview" ADD CONSTRAINT "PriceReview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
