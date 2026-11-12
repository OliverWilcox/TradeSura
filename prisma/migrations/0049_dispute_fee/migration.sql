-- Stripe's dispute fee is the engineer's too (Matt, 12 Nov): debited from their balance.
ALTER TABLE "PlanDispute" ADD COLUMN "feePence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlanDispute" ADD COLUMN "feeDebitId" TEXT;
