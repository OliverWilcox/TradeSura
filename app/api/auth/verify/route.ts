import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyToken } from "@/lib/auth";
import { LOCK_MS, MAX_ATTEMPTS, hashCode, isLocked, sessionToken } from "@/lib/sign-in-code";

const Body = z.object({ requestToken: z.string().min(1), code: z.string().regex(/^\d{4}$/) });

// Sign-in step 2 (4 Oct build notes, section 2): code matches → session.
// Codes work once; the fifth wrong try blocks the account for 15 minutes.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 4-digit code." }, { status: 400 });
  }
  const payload = await verifyToken(parsed.data.requestToken);
  const row = payload?.signInCodeId
    ? await prisma.signInCode.findUnique({ where: { id: payload.signInCodeId } })
    : null;
  const now = new Date();
  if (row?.usedAt && row.expiresAt > now) {
    const newer = await prisma.signInCode.findFirst({
      where: { engineerId: row.engineerId, createdAt: { gt: row.createdAt } },
    });
    if (newer) {
      return NextResponse.json(
        { error: "We sent you a newer code — use the one in the latest email." },
        { status: 400 },
      );
    }
  }
  if (!row || row.expiresAt < now || row.usedAt) {
    return NextResponse.json(
      { error: "That code has expired — tap Resend code for a new one." },
      { status: 400 },
    );
  }
  if (await isLocked(row.engineerId, now)) {
    return NextResponse.json({ error: "Too many wrong codes — try again in 15 minutes." }, { status: 429 });
  }

  if (hashCode(parsed.data.code) !== row.codeHash) {
    // Increment in the database so simultaneous guesses cannot overwrite each other.
    const updated = await prisma.signInCode.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    const lock = updated.attempts >= MAX_ATTEMPTS;
    if (lock) {
      await prisma.signInCode.update({
        where: { id: row.id },
        data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
      });
    }
    return NextResponse.json(
      {
        error: lock
          ? "Too many wrong codes — try again in 15 minutes."
          : "That code doesn't match — check it and try again.",
      },
      { status: lock ? 429 : 400 },
    );
  }

  // Conditional so two racing requests can't both spend one code.
  const spent = await prisma.signInCode.updateMany({
    where: { id: row.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS }, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (spent.count === 0) {
    return NextResponse.json(
      { error: "That code has already been used — tap Resend code for a new one." },
      { status: 400 },
    );
  }
  return NextResponse.json({ token: await sessionToken(row.engineerId) });
}
