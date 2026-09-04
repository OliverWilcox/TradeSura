-- Review #18 terms versioning + #13 duplicate Gas Safe number guard.

-- IF NOT EXISTS on each statement below: Prisma's migrate deploy runs this
-- file statement-by-statement, not as one wrapped transaction, so the first
-- failed attempt at this migration left these columns already committed
-- before the (now-fixed) unique-index step failed. Idempotent, safe to
-- re-run regardless of how far a prior attempt got.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "termsVersion" TEXT;
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "termsAgreedAt" TIMESTAMP(3);

-- Self-heal pre-existing duplicate Gas Safe numbers before enforcing
-- uniqueness (this deploy failed once already on a real prod duplicate,
-- 584123). Keep the earliest-created account's number, null the rest —
-- nulling rather than deleting/renaming is the low-risk choice: the
-- affected account just shows "not yet Gas Safe verified" until they
-- re-verify, nothing is lost. Idempotent — a re-run with no duplicates
-- left is a no-op.
WITH ranked AS (
  SELECT id, "gasSafeNo",
         ROW_NUMBER() OVER (PARTITION BY "gasSafeNo" ORDER BY "createdAt" ASC) AS rn
  FROM "Engineer"
  WHERE "gasSafeNo" IS NOT NULL
)
UPDATE "Engineer"
SET "gasSafeNo" = NULL
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS "Engineer_gasSafeNo_key" ON "Engineer"("gasSafeNo");
