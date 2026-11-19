-- Matt, 4 Nov, 3.5: Stripe's own deadline for what it has asked a finished
-- account for, kept from account.updated and the admin's reads, so the
-- "Stripe stage 2 not finished" call list sorts by it. Additive only.

-- AlterTable
ALTER TABLE "Engineer" ADD COLUMN     "stripeRequirementsDeadline" TIMESTAMP(3);
