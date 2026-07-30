-- CreateEnum
CREATE TYPE "ClauseStatus" AS ENUM ('SAFE', 'CARE');

-- AlterTable
ALTER TABLE "ClauseTemplate" ADD COLUMN     "category" TEXT NOT NULL DEFAULT 'Core gas servicing',
ADD COLUMN     "highlight" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pricingLabel" TEXT,
ADD COLUMN     "status" "ClauseStatus" NOT NULL DEFAULT 'SAFE',
ADD COLUMN     "upliftPence" INTEGER;
