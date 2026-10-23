import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { sendEmail, emailConfigured } from "@/lib/email";
import { codeEmail } from "@/lib/code-email";
import { sendVerificationCode } from "@/lib/sms";
import { CODE_TTL_MS, RESEND_AFTER_MS, hashCode } from "@/lib/sign-in-code";

export function smsAvailable() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_NUMBER);
}
export const SUPERSEDED_MESSAGE = "We sent you a newer code — use the one in the latest email.";
export class VerificationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Purpose = "signup-email" | "signup-sms" | "enable-sms" | "signin-sms";
// All attempts and resends for a destination share a lock, even across app instances.
export async function requestContactCode(purpose: Purpose, destination: string, claims: Record<string, string>) {
  const sms = purpose !== "signup-email";
  // Local development only, with no provider set up: hand the code back so
  // the screen can fill it in (same as sign-in's devCode). Never in production.
  const devNoProvider = process.env.NODE_ENV === "development" && (sms ? !smsAvailable() : !emailConfigured());
  if (!devNoProvider && (sms ? !smsAvailable() : !emailConfigured())) throw new VerificationError(`${sms ? "Text messages" : "Verification emails"} are unavailable right now. Please try again later.`, 503);
  const scope = `${purpose}:${destination}`;
  const code = String(randomInt(1000, 10000));
  const row = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
    const now = new Date();
    const locked = await tx.signInCode.findFirst({ where: { engineerId: scope, lockedUntil: { gt: now } } });
    if (locked) throw new VerificationError("Too many wrong codes — try again in 15 minutes.", 429);
    const last = await tx.signInCode.findFirst({ where: { engineerId: scope }, orderBy: { createdAt: "desc" } });
    if (last && now.getTime() - last.createdAt.getTime() < RESEND_AFTER_MS) throw new VerificationError("We've just sent a code — you can ask for another after a minute.", 429);
    // Preserve the wrong-attempt budget when resending within the current window.
    const attempts = last && now.getTime() - last.createdAt.getTime() < 900_000 ? last.attempts : 0;
    await tx.signInCode.updateMany({ where: { engineerId: scope, usedAt: null }, data: { usedAt: now } });
    return tx.signInCode.create({ data: { engineerId: scope, channel: purpose, codeHash: hashCode(code), attempts, expiresAt: new Date(now.getTime() + CODE_TTL_MS) } });
  });
  if (devNoProvider) {
    console.log(`[dev] ${purpose} code for ${destination}: ${code}`);
    return { requestToken: await signToken({ contactCodeId: row.id, purpose, ...claims }, "10m"), devCode: code };
  }
  try {
    if (sms) await sendVerificationCode(destination, code);
    else await sendEmail({ to: destination, ...codeEmail({ code, expiresAt: row.expiresAt }) });
  } catch {
    await prisma.signInCode.delete({ where: { id: row.id } });
    throw new VerificationError("We couldn't send your code — please try again.", 503);
  }
  return { requestToken: await signToken({ contactCodeId: row.id, purpose, ...claims }, "10m") };
}
export async function verifyContactCode(requestToken: string, code: string, purpose: Purpose) {
  if (!/^\d{4}$/.test(code)) throw new VerificationError("Enter the four-digit code.");
  const payload = await verifyToken(requestToken);
  if (!payload?.contactCodeId || payload.purpose !== purpose) throw new VerificationError("That code has expired — request a new one.");
  const initial = await prisma.signInCode.findUnique({ where: { id: payload.contactCodeId } });
  if (!initial || initial.channel !== purpose) throw new VerificationError("That code has expired — request a new one.");
  const outcome = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.engineerId}))`;
    const row = await tx.signInCode.findUnique({ where: { id: initial.id } });
    const now = new Date();
    if (!row || row.expiresAt <= now) return "expired";
    if (row.usedAt) {
      // Review 3 P0 — a resend cancels the old code; say so rather than
      // "expired" when the email in hand is simply the older one.
      const newer = await tx.signInCode.findFirst({ where: { engineerId: row.engineerId, createdAt: { gt: row.createdAt } } });
      if (newer) return "superseded";
      // Same code sent twice (autofill and a Continue tap racing): the first
      // already passed, so this one is the same proof, not a new guess.
      return row.codeHash === hashCode(code) ? "ok" : "expired";
    }
    if (await tx.signInCode.findFirst({ where: { engineerId: row.engineerId, lockedUntil: { gt: now } } })) return "locked";
    if (row.codeHash !== hashCode(code)) {
      const attempts = row.attempts + 1;
      await tx.signInCode.update({ where: { id: row.id }, data: { attempts, ...(attempts >= 5 ? { lockedUntil: new Date(now.getTime() + 900_000) } : {}) } });
      return attempts >= 5 ? "locked" : "wrong";
    }
    await tx.signInCode.update({ where: { id: row.id }, data: { usedAt: now } });
    return "ok";
  });
  if (outcome !== "ok") throw new VerificationError(outcome === "locked" ? "Too many wrong codes — try again in 15 minutes." : outcome === "superseded" ? SUPERSEDED_MESSAGE : outcome === "expired" ? "That code has expired — request a new one." : "That code doesn't match — try again.", outcome === "locked" ? 429 : 400);
  return payload;
}
