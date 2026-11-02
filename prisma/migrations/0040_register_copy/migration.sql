-- QA-07: the register copy can hold the business address and the card's
-- expiry when the imported file has them. Nullable; existing rows keep NULLs.
ALTER TABLE "GasSafeRecord" ADD COLUMN "address" TEXT,
ADD COLUMN "postcode" TEXT,
ADD COLUMN "cardExpiresOn" DATE;
