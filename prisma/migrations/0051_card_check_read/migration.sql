-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "gasSafeCardReadId" TEXT;

UPDATE "Engineer" e SET "gasSafeCardReadId" = (
  SELECT r.id FROM "GasSafeCardRead" r
  WHERE r."engineerId" = e.id AND r.complete AND r."cardUrl" = e."gasSafeCardUrl"
  ORDER BY r."createdAt" DESC, r.id DESC LIMIT 1
)
WHERE e."gasSafeVerifiedAt" IS NOT NULL;
