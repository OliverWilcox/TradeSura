-- Review 4 (R11): the customer's plan card says the attendance charge is
-- waived, not just "No call-out / attendance fees". Data only.
UPDATE "ClauseTemplate"
SET "note" = 'your attendance charge is waived when we attend'
WHERE "code" = 'NO_CALLOUT_FEE';
