-- Build Review 3: trading/legal name, sole owner, VAT, qualification
-- confirmations (R12), engineer-set rates (R6), landlord let confirmation (R9).
ALTER TABLE "Engineer" ADD COLUMN "legalName" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "soleOwner" BOOLEAN;
ALTER TABLE "Engineer" ADD COLUMN "vatRegistered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Engineer" ADD COLUMN "qualificationConfirmations" JSONB;
ALTER TABLE "PlanTier" ADD COLUMN "clauseRates" JSONB;
ALTER TABLE "Plan" ADD COLUMN "propertyLetConfirmedAt" TIMESTAMP(3);

-- Production never runs prisma/seed.ts, so the library changes land here.
-- Agreed plans keep their agreedTier snapshot.
-- R1/R7: priority booking with no attendance time.
UPDATE "ClauseTemplate"
SET "title" = 'Priority booking',
    "bodyText" = 'You go to the front of the queue when you need us. Subject to availability, no set attendance time.'
WHERE "code" = 'PRIORITY_48H';
-- R7: hidden until the wording is vetted.
UPDATE "ClauseTemplate" SET "status" = 'CARE' WHERE "code" IN ('SAMEDAY_PRIORITY', 'WARRANTY_ADMIN');
-- R11: a waived attendance charge, not a promise to attend.
UPDATE "ClauseTemplate"
SET "bodyText" = 'When we attend a visit you request under this plan, our usual attendance charge is waived. This is not a promise to attend at any particular time. Labour and parts for any work carried out remain chargeable at the rates shown in your plan.',
    "engineerNote" = 'your attendance charge is waived when you attend'
WHERE "code" = 'NO_CALLOUT_FEE';
