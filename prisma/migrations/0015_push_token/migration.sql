-- Build Guide v2 Part 11 — push notifications. Nullable; set once the app
-- has asked permission and registered a device token (POST /api/me/push-token).
ALTER TABLE "Engineer" ADD COLUMN "expoPushToken" TEXT;
