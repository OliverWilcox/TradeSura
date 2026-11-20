-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "gasSafeCardSource" TEXT,
ADD COLUMN     "gasSafeCardBackSource" TEXT;

-- AlterTable
ALTER TABLE "ClaimCode" ADD COLUMN     "reminderTextedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TpsScreen" (
    "id" TEXT NOT NULL,
    "numbers" TEXT[],
    "registered" TEXT[],
    "createdById" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "answeredBy" TEXT,

    CONSTRAINT "TpsScreen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TpsScreen_answeredAt_idx" ON "TpsScreen"("answeredAt");
