-- 2026 Build Guide: the annual service (already optional, 0022) is
-- available after the customer's third payment, shown as small print; the
-- builder's Step 4 records the engineer's provision promise.
ALTER TABLE "ClauseTemplate" ADD COLUMN "note" TEXT;
ALTER TABLE "ClauseTemplate" ADD COLUMN "engineerNote" TEXT;
ALTER TABLE "PlanTier" ADD COLUMN "providerAttestedAt" TIMESTAMP(3);

-- Production never runs prisma/seed.ts, so the library change lands here.
-- Agreed plans keep their agreedTier snapshot.
UPDATE "ClauseTemplate"
SET "note" = 'available after your third payment',
    "engineerNote" = 'available after the customer''s 3rd payment',
    "bodyText" = 'We will carry out one scheduled service of your boiler in each 12-month plan period, including the safety checks and maintenance recommended by the manufacturer. Your first service is available once your third monthly payment has been collected.'
WHERE "code" = 'ANNUAL_SERVICE';
