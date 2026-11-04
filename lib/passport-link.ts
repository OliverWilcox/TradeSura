import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl } from "@/lib/app-url";

// The homeowner's Home Passport link, as it goes out in texts and emails.
// One place, so how the link is made (and checked) can change without
// touching every message.
//
// Matt, 4 Nov: a forwarded link must show nothing personal, and links
// expire. So each link carries a signed expiry (no schema change, and a
// link can't be stretched by editing the date), and opening it only shows
// the passport after a one-time code texted to the homeowner
// (lib/passport-session.ts). Links sent before this have no signature and
// count as expired; the page offers a fresh one by text.
export const PASSPORT_LINK_DAYS = 30;

function sign(viewToken: string, expires: number): string {
  const key = process.env.SESSION_SECRET ?? "";
  return createHmac("sha256", key).update(`passport:${viewToken}:${expires}`).digest("base64url").slice(0, 22);
}

/** The path with a fresh signed expiry, for links inside our own pages. */
export function passportPath(viewToken: string, now = new Date()): string {
  const e = Math.floor(now.getTime() / 1000) + PASSPORT_LINK_DAYS * 24 * 60 * 60;
  return `/passport/${viewToken}?e=${e}&s=${sign(viewToken, e)}`;
}

export function passportUrl(viewToken: string, now = new Date()): string {
  return `${appUrl()}${passportPath(viewToken, now)}`;
}

/** Whether a link's expiry and signature are good: "ok", or "expired" for a past, unsigned or edited one. */
export function passportLinkState(
  viewToken: string,
  e: string | null | undefined,
  s: string | null | undefined,
  now = new Date(),
): "ok" | "expired" {
  const expires = Number(e);
  if (!e || !s || !Number.isInteger(expires)) return "expired";
  const expected = Buffer.from(sign(viewToken, expires));
  const given = Buffer.from(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "expired";
  return expires * 1000 > now.getTime() ? "ok" : "expired";
}
