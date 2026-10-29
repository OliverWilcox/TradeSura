-- Review 4: a CP12 weighs ~£5 a month in the builder's guide price (was £3),
-- so Landlord Care guides at £16 rather than £14 next to Boiler Care's £13.
-- Data only; prices engineers already set are untouched.
UPDATE "ClauseTemplate" SET "upliftPence" = 500 WHERE "code" = 'CP12';
