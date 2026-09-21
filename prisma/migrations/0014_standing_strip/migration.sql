-- Build Guide v2 Part 6.4 — the standing-strip state machine's paused/banned
-- states. No admin UI sets these yet (Part 19-style: mechanism now, trigger
-- later); nullable, defaulted off.
ALTER TABLE "Engineer" ADD COLUMN "pausedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "pauseReason" TEXT;
ALTER TABLE "Engineer" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "Engineer" ADD COLUMN "banReason" TEXT;
