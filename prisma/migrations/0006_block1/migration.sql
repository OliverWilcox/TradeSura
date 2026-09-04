-- Block 1: engineer attribution + founding-member pack, customer acquisition source.

ALTER TABLE "Engineer" ADD COLUMN     "attribution" JSONB,
ADD COLUMN     "packAddress" TEXT,
ADD COLUMN     "packRequestedAt" TIMESTAMP(3);

ALTER TABLE "Customer" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'added';
