import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { sendEmail, emailConfigured } from "@/lib/email";
import { codeEmail } from "@/lib/code-email";
import { sendVerificationCode } from "@/lib/sms";
import { hashCode } from "@/lib/sign-in-code";

export function smsAvailable() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_NUMBER);
}
export class VerificationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
type Purpose = "signup-email" | "signup-sms" | "enable-sms" | "signin-sms";
// All attempts and resends for a destination share a lock, even across app instances.
export async function requestContactCode(purpose: Purpose, destination: string, claims: Record<string, string>) {
  const sms = purpose !== "signup-email";
  if (sms ? !smsAvailable() : !emailConfigured()) throw new VerificationError(`${sms ? "Text messages" : "Verification emails"} are unavailable right now. Please try again later.`, 503);
  const scope = `${purpose}:${destination}`;
  const code = String(randomInt(1000, 10000));
  const row = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
    const now = new Date();
    const locked = await tx.signInCode.findFirst({ where: { engineerId: scope, lockedUntil: { gt: now } } });
    if (locked) throw new VerificationError("Too many wrong codes — try again in 15 minutes.", 429);
    const last = await tx.signInCode.findFirst({ where: { engineerId: scope }, orderBy: { createdAt: "desc" } });
    if (last && now.getTime() - last.createdAt.getTime() < 30_000) throw new VerificationError("Wait 30 seconds before requesting another code.", 429);
    // Preserve the wrong-attempt budget when resending within the current window.
    const attempts = last && now.getTime() - last.createdAt.getTime() < 900_000 ? last.attempts : 0;
    await tx.signInCode.updateMany({ where: { engineerId: scope, usedAt: null }, data: { usedAt: now } });
    return tx.signInCode.create({ data: { engineerId: scope, channel: purpose, codeHash: hashCode(code), attempts, expiresAt: new Date(now.getTime() + 600_000) } });
  });
  try {
    if (sms) await sendVerificationCode(destination, code);
    else await sendEmail({ to: destination, ...codeEmail({ code, expiresAt: new Date(Date.now() + 10 * 60 * 1000) }) });
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
    if (!row || row.usedAt || row.expiresAt <= now) return "expired";
    if (await tx.signInCode.findFirst({ where: { engineerId: row.engineerId, lockedUntil: { gt: now } } })) return "locked";
    if (row.codeHash !== hashCode(code)) {
      const attempts = row.attempts + 1;
      await tx.signInCode.update({ where: { id: row.id }, data: { attempts, ...(attempts >= 5 ? { lockedUntil: new Date(now.getTime() + 900_000) } : {}) } });
      return attempts >= 5 ? "locked" : "wrong";
    }
    await tx.signInCode.update({ where: { id: row.id }, data: { usedAt: now } });
    return "ok";
  });
  if (outcome !== "ok") throw new VerificationError(outcome === "locked" ? "Too many wrong codes — try again in 15 minutes." : outcome === "expired" ? "That code has expired — request a new one." : "That code doesn't match — try again.", outcome === "locked" ? 429 : 400);
  return payload;
}
