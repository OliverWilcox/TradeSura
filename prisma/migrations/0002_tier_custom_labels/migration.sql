-- AlterTable
ALTER TABLE "PlanTier" ADD COLUMN     "customLabels" TEXT[] DEFAULT ARRAY[]::TEXT[];
