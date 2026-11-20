-- Impersonation check (Matt, 16 Nov): the engineer's name against the
-- company's officers and PSCs; not listed → limited until an admin clears it.
ALTER TABLE "Engineer" ADD COLUMN "companyRoleCheck" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "companyRoleCheckedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "companyRoleFlaggedAt" TIMESTAMP(3);
