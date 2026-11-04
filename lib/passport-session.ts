import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";

// Matt, 4 Nov — holding the passport link is no longer enough: the
// homeowner enters a one-time code texted to the mobile on their plan, and
// this cookie (one per passport, signed, httpOnly) lets them in for a while.
// A forwarded link shows nothing personal to whoever opens it.
export const PASSPORT_SESSION_HOURS = 12;

const cookieName = (passportId: string) => `ts_passport_${passportId}`;

export async function grantPassportSession(passportId: string) {
  const token = await signToken({ passportView: passportId }, `${PASSPORT_SESSION_HOURS}h`);
  (await cookies()).set(cookieName(passportId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PASSPORT_SESSION_HOURS * 60 * 60,
  });
}

export async function hasPassportSession(passportId: string): Promise<boolean> {
  const value = (await cookies()).get(cookieName(passportId))?.value;
  if (!value) return false;
  const payload = await verifyToken(value);
  return payload?.passportView === passportId;
}

/**
 * The homeowner's mobiles: the customers on plans at this home (any status:
 * a cancelled plan still leaves the history theirs to read), and anyone
 * whose address is linked to it. Deleted customers' scrubbed numbers drop out.
 */
export async function passportPhones(passportId: string): Promise<string[]> {
  const [plans, properties] = await Promise.all([
    prisma.plan.findMany({ where: { passportId }, select: { customer: { select: { phone: true } } }, orderBy: { createdAt: "desc" } }),
    prisma.property.findMany({ where: { passportId }, select: { customer: { select: { phone: true } } } }),
  ]);
  const phones = [...plans, ...properties].map((r) => r.customer.phone).filter((p) => p && p.startsWith("+"));
  return [...new Set(phones)];
}

/** "mobile ending 23": enough for the homeowner to know which phone, nothing for anyone else. */
export function maskedMobile(phone: string): string {
  return `mobile ending ${phone.slice(-2)}`;
}
