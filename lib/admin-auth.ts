import { timingSafeEqual } from "node:crypto";

// Admin pages are gated by ADMIN_SECRET (open /admin/…?key=…) until real
// admin accounts exist — the same check as app/admin/verifications.
export function adminAuthorised(key: string | null | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !key || key.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(key), Buffer.from(secret));
}
