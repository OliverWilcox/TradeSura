-- 2026 Build Guide getting-started hub: public profile (Get found on Google),
-- website embed (Connect your website) and invite-shared tracking.
ALTER TABLE "Engineer" ADD COLUMN "profileBio" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "serviceArea" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "profilePublishedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "websiteConnectedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "websiteHost" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "inviteSharedAt" TIMESTAMP(3);
