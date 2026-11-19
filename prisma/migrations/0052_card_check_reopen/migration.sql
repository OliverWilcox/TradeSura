-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "gasSafeReopenedAt" TIMESTAMP(3),
ADD COLUMN     "gasSafeVerifiedBeforeReopenAt" TIMESTAMP(3),
ADD COLUMN     "gasSafeRegisterCheckedBeforeReopenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GasSafeCardRead" ADD COLUMN     "suspect" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "Event" ("id", "name", "actorType", "ts", "meta")
SELECT 'reopen-0052-' || e.id, 'gas_safe_card_check_reopened', 'SYSTEM'::"ActorType", CURRENT_TIMESTAMP,
  jsonb_build_object('engineerId', e.id, 'reason', 'Marked live without a read Gas Safe card', 'via', 'migration 0052', 'verifiedAt', e."gasSafeVerifiedAt", 'registerCheckedAt', e."gasSafeRegisterCheckedAt", 'recheckRequestedAt', e."gasSafeRecheckRequestedAt", 'recheckReason', e."gasSafeRecheckReason")
FROM "Engineer" e
WHERE e."gasSafeVerifiedAt" IS NOT NULL AND e."gasSafeCardReadId" IS NULL AND e."deletedAt" IS NULL;

UPDATE "Engineer" SET
  "gasSafeReopenedAt" = CURRENT_TIMESTAMP,
  "gasSafeVerifiedBeforeReopenAt" = "gasSafeVerifiedAt",
  "gasSafeRegisterCheckedBeforeReopenAt" = "gasSafeRegisterCheckedAt",
  "gasSafeVerifiedAt" = NULL,
  "gasSafeRegisterCheckedAt" = NULL,
  "gasSafeRecheckRequestedAt" = NULL,
  "gasSafeRecheckReason" = NULL,
  "gasSafeReviewRequestedAt" = CURRENT_TIMESTAMP
WHERE "gasSafeVerifiedAt" IS NOT NULL AND "gasSafeCardReadId" IS NULL AND "deletedAt" IS NULL;
