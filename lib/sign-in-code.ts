// 4 Oct build notes, section 2 — sign-in is email → 4-digit code → signed in
// (by text once SMS is live). Before this, knowing an engineer's email was
// enough to open their account.
import { createHash, randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { emailConfigured, sendEmail } from "@/lib/email";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_AFTER_MS = 30 * 1000;
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

type Issued =
  | { ok: true; requestToken: string; devCode?: string }
  | { ok: false; status: number; error: string };

export async function issueSignInCode(engineer: { id: string; email: string }): Promise<Issued> {
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
    return { ok: false, status: 429, error: "We've just sent a code — wait a few seconds before asking for another." };
  }

  const code = String(randomInt(1000, 10000));
  const row = await prisma.signInCode.create({
    data: {
      engineerId: engineer.id,
      channel: "email",
      codeHash: hashCode(code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
  });

  try {
    await sendEmail({
      to: engineer.email,
      subject: `${code} is your TradeSura sign-in code`,
      html: `<p>Your TradeSura sign-in code is:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:monospace">${code}</p>
<p>It works once and expires at ${ukTime(new Date(Date.now() + CODE_TTL_MS))} (UK time). If you didn't try to sign in, you can ignore this email — nobody can get in without the code.</p>`,
    });
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
