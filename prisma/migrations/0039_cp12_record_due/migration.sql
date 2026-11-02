-- Review 4: landlord sign-up asks when the current gas safety record is due,
-- and records a request for a one-off CP12 when it falls before the plan's own.
ALTER TABLE "Plan" ADD COLUMN "gasSafetyRecordDueAt" TIMESTAMP(3);
ALTER TABLE "Plan" ADD COLUMN "oneOffCp12RequestedAt" TIMESTAMP(3);

-- The CP12 follows the 3rd-payment rule like the annual service.
UPDATE "ClauseTemplate" SET
  "note" = 'available after your third payment',
  "engineerNote" = 'available after the customer''s 3rd payment',
  "bodyText" = 'One landlord gas safety record (CP12) per property in each 12-month plan period. Your first gas safety record under the plan is available once your third monthly payment has been collected.'
WHERE "code" = 'CP12';
