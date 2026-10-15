-- Build Review 2, section 8: team accounts (owner + staff) and section 10:
-- in-app account deletion.
ALTER TABLE "Engineer" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "staffRemovedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD CONSTRAINT "Engineer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Customer" ADD COLUMN "addedById" TEXT;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Plan" ADD COLUMN "soldById" TEXT;
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "Engineer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
