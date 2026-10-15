-- Build Review 2, ruling 2: the annual service is ticked by default but
-- optional. Data-only; the seed sets the same values for fresh databases.
UPDATE "ClauseTemplate"
SET "kind" = 'ADD', "pricingLabel" = 'ticked by default'
WHERE "code" = 'ANNUAL_SERVICE';
