-- LAW (plan wording is locked). A tier can be edited after customers have
-- joined it, so the contract each customer agreed to is snapshotted onto
-- their Plan at tier-selection. Reads of the agreed plan resolve through
-- lib/plan-tier.ts and prefer this snapshot over the live tier.
ALTER TABLE "Plan" ADD COLUMN IF NOT EXISTS "agreedTier" JSONB;
