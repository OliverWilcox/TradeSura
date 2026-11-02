// 4 Oct build notes, section 2 — sign-in is email → 4-digit code → signed in
// (by text once SMS is live). Before this, knowing an engineer's email was
// enough to open their account.
import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { emailConfigured, sendEmail } from "@/lib/email";
import { codeEmail } from "@/lib/code-email";

export const CODE_TTL_MS = 10 * 60 * 1000;
// Review 3 P0 — "Resend code" after 60 seconds, and a resend cancels the
// old code (the newest email is always the one that works).
export const RESEND_AFTER_MS = 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const LOCK_MS = 15 * 60 * 1000;
// "Stay signed in" — a code is only needed on a new device or after sign-out.
export const SESSION_TTL = "180d";

// Build Review 2 — an explicit expiry time in UK time, so an older code email
// is obvious next to a newer one whatever the mail app shows.
export function ukTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

// m•••@example.com — enough to recognise, not enough to harvest.
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}•••@${domain}`;
}

// CONFIG: SIGNIN_CODES=off switches back to instant sign-in. Only for while
// email can't be delivered yet (Resend domain not verified) — never for pilots.
export function signInCodesEnabled(): boolean {
  return process.env.NODE_ENV !== "development" || process.env.SIGNIN_CODES !== "off";
}

export async function isLocked(engineerId: string, now = new Date()): Promise<boolean> {
  return Boolean(
    await prisma.signInCode.findFirst({ where: { engineerId, OR: [
      { lockedUntil: { gt: now } },
      { attempts: { gte: MAX_ATTEMPTS }, lockedUntil: null, expiresAt: { gt: now } },
    ] } }),
  );
}

// App Store review (30 Oct update 2.3): Apple's reviewer can't receive our
// emails, so one named account signs in with a fixed code instead. Both env
// vars must be set, the code must be the app's 4 digits (the code box takes
// 4 and the build under review can't change), and only that exact email gets
// it. Everything else about the code is unchanged: same row, same expiry,
// same wrong-try lockout. Unset either var to switch it off after approval.
export function reviewCodeFor(email: string): string | null {
  const reviewEmail = process.env.APP_REVIEW_EMAIL?.trim().toLowerCase();
  const code = process.env.APP_REVIEW_CODE?.trim();
  if (!reviewEmail || !code || !/^\d{4}$/.test(code)) return null;
  return email.trim().toLowerCase() === reviewEmail ? code : null;
}

type Issued =
  | { ok: true; requestToken: string; devCode?: string }
  | { ok: false; status: number; error: string };

export async function issueSignInCode(engineer: {
  id: string;
  email: string;
  firstName?: string | null;
}): Promise<Issued> {
  if (!emailConfigured() && process.env.NODE_ENV !== "development") {
    return { ok: false, status: 503, error: "Sign-in emails are unavailable — please contact info@tradesura.com." };
  }
  const now = new Date();
  if (await isLocked(engineer.id, now)) {
    return { ok: false, status: 429, error: "Too many wrong codes — try again in 15 minutes." };
  }
  const last = await prisma.signInCode.findFirst({
    where: { engineerId: engineer.id },
    orderBy: { createdAt: "desc" },
  });
  if (last && now.getTime() - last.createdAt.getTime() < RESEND_AFTER_MS) {
    return { ok: false, status: 429, error: "We've just sent a code — you can ask for another after a minute." };
  }

  const reviewCode = reviewCodeFor(engineer.email);
  const code = reviewCode ?? String(randomInt(1000, 10000));
  // The email states the same expiry the row holds — one clock, no drift.
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await prisma.signInCode.updateMany({
    where: { engineerId: engineer.id, usedAt: null },
    data: { usedAt: now },
  });
  const row = await prisma.signInCode.create({
    data: {
      engineerId: engineer.id,
      channel: "email",
      codeHash: hashCode(code),
      // A resend keeps the wrong-guess count, so resending can't reset the lock.
      attempts: last && now.getTime() - last.createdAt.getTime() < LOCK_MS ? last.attempts : 0,
      expiresAt,
    },
  });

  // The review account's address isn't a real inbox: nothing to send.
  if (reviewCode) return { ok: true, requestToken: await signToken({ signInCodeId: row.id }, "10m") };

  try {
    // 2026 Build Guide code-email mock-up.
    const { subject, html } = codeEmail({
      code,
      firstName: engineer.firstName,
      expiresAt,
      purpose: "sign in",
    });
    await sendEmail({ to: engineer.email, subject, html });
  } catch (err) {
    console.error("[sign-in] code email failed:", err);
    await prisma.signInCode.delete({ where: { id: row.id } }).catch(() => {});
    return {
      ok: false,
      status: 503,
      error:
        "We couldn't send your sign-in code just now. Please try again — if it keeps happening, email info@tradesura.com",
    };
  }

  const requestToken = await signToken({ signInCodeId: row.id }, "10m");
  // Dev only (no email provider configured): hand the code back so the
  // screen can say honestly that nothing was sent, same as the phone check.
  return { ok: true, requestToken, ...(process.env.NODE_ENV === "development" && !emailConfigured() ? { devCode: code } : {}) };
}

// Staff sessions carry their owner's id (`biz`) so lib/auth.ts can scope them
// to that business and check the link still stands on every request.
export async function sessionToken(engineerId: string): Promise<string> {
  const row = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { ownerId: true } });
  return signToken(row?.ownerId ? { engineerId, biz: row.ownerId } : { engineerId }, SESSION_TTL);
}
