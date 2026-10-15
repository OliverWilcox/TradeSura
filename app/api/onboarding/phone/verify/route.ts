import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";

const Body = z.object({ requestToken: z.string().min(1), code: z.string().min(4).max(8) });

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

// Step 2 of the phone check: on a match, hands back a short-lived "this phone
// is verified" token. /api/auth/request re-verifies it server-side before
// trusting it, so the wizard can carry it around client-side safely. Codes
// work once; the fifth wrong try blocks the number for 15 minutes.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });
  }

  const payload = await verifyToken(parsed.data.requestToken);
  const otp = payload?.otpId
    ? await prisma.phoneOtp.findUnique({ where: { id: payload.otpId } })
    : null;
  const now = new Date();
  if (!otp || otp.expiresAt < now || otp.usedAt) {
    return NextResponse.json(
      { error: "That code has expired — we'll send a new one when you tap Continue." },
      { status: 400 },
    );
  }

  const locked = await prisma.phoneOtp.findFirst({
    where: { phone: otp.phone, lockedUntil: { gt: now } },
  });
  if (locked) {
    return NextResponse.json(
      { error: "Too many wrong codes — try again in 15 minutes." },
      { status: 429 },
    );
  }

  const submittedHash = createHash("sha256").update(parsed.data.code.trim()).digest("hex");
  if (submittedHash !== otp.codeHash) {
    const attempts = otp.attempts + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await prisma.phoneOtp.update({
      where: { id: otp.id },
      data: { attempts, ...(lock ? { lockedUntil: new Date(now.getTime() + LOCK_MS) } : {}) },
    });
    return NextResponse.json(
      {
        error: lock
          ? "Too many wrong codes — try again in 15 minutes."
          : "That code doesn't match — check and try again.",
      },
      { status: lock ? 429 : 400 },
    );
  }

  // Conditional update so two racing requests can't both spend one code.
  const spent = await prisma.phoneOtp.updateMany({
    where: { id: otp.id, usedAt: null },
    data: { usedAt: now },
  });
  if (spent.count === 0) {
    return NextResponse.json(
      { error: "That code has already been used — tap Continue for a new one." },
      { status: 400 },
    );
  }

  // 4 Oct notes, step 1.1 — "verified" only when a text actually went out.
  const texted = payload?.texted === "1";
  const phoneToken = await signToken(
    { phone: otp.phone, verified: "1", ...(texted ? { texted: "1" } : {}) },
    "30m",
  );
  return NextResponse.json({ phoneToken, phone: otp.phone, texted });
}
