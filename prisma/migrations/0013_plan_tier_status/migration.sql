-- Build Guide v2 Part 7.3/7.4 — a plan is a listing with three states
-- (DRAFT / LIVE / STOPPED), replacing the old archived boolean. Existing
-- rows were all being offered, so they become LIVE (or STOPPED if they were
-- already archived); only plans created from here on start as DRAFT.
CREATE TYPE "PlanTierStatus" AS ENUM ('DRAFT', 'LIVE', 'STOPPED');

ALTER TABLE "PlanTier" ADD COLUMN "status" "PlanTierStatus" NOT NULL DEFAULT 'LIVE';
UPDATE "PlanTier" SET "status" = 'STOPPED' WHERE "archived" = true;
ALTER TABLE "PlanTier" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "PlanTier" DROP COLUMN "archived";
