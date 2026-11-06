-- Matt, 6 Nov: the Grow cards (first 10, first month goal, how-to video, staff commission).
ALTER TABLE "Engineer" ADD COLUMN "monthlyGoal" INTEGER,
ADD COLUMN "monthlyGoalSetAt" TIMESTAMP(3),
ADD COLUMN "goalNudgedAt" TIMESTAMP(3),
ADD COLUMN "howToVideoWatchedAt" TIMESTAMP(3),
ADD COLUMN "staffCommissionType" TEXT,
ADD COLUMN "staffCommissionPence" INTEGER;

ALTER TABLE "Plan" ADD COLUMN "offerSource" TEXT;
