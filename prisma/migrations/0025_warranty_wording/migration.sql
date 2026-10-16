-- Build Review 2: the warranty option no longer reads as a guarantee.
-- Data-only; the seed sets the same title for fresh databases.
UPDATE "ClauseTemplate"
SET "title" = 'Annual service on schedule and logged for your manufacturer warranty'
WHERE "code" = 'WARRANTY_VALID';
