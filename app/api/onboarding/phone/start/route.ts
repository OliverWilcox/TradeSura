import { NextResponse } from "next/server";
import { createHash, randomInt } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken } from "@/lib/auth";
import { normaliseUkPhone } from "@/lib/phone";
import { sendVerificationCode } from "@/lib/sms";

const Body = z.object({ phone: z.string().min(6).max(20) });

const CODE_TTL_MS = 10 * 60 * 1000;

// Step 1 of the signup wizard's phone check. Each code is a PhoneOtp row
// (hash only) so /verify can enforce single use and the 5-try lockout
// (30 Sept build notes, step 1 item 15); the client carries a token naming
// the row.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your mobile number." }, { status: 400 });
  }
  const phone = normaliseUkPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a UK mobile number." }, { status: 400 });
  }

  // 4 Oct build notes, P0 — one mobile, one account, caught here the moment
  // the number is entered rather than as a failure at step 3.
  if (await prisma.engineer.findUnique({ where: { phone } })) {
    return NextResponse.json(
      { error: "This mobile is already registered. Sign in instead?", code: "phone_taken", field: "phone" },
      { status: 409 },
    );
  }

  const locked = await prisma.phoneOtp.findFirst({
    where: { phone, lockedUntil: { gt: new Date() } },
  });
  if (locked) {
    return NextResponse.json(
      { error: "Too many wrong codes — try again in 15 minutes." },
      { status: 429 },
    );
  }

  const code = String(randomInt(100000, 1000000));
  const otp = await prisma.phoneOtp.create({
    data: {
      phone,
      codeHash: createHash("sha256").update(code).digest("hex"),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });
  let devCode: string | undefined;
  try {
    ({ devCode } = await sendVerificationCode(phone, code));
  } catch {
    await prisma.phoneOtp.delete({ where: { id: otp.id } });
    return NextResponse.json({ error: "We couldn't send your verification text — please try again or email info@tradesura.com." }, { status: 503 });
  }
  // `texted` rides in the token so /verify (and signup) know whether the
  // mobile was really proven by a text, or only by the dev test code.
  const requestToken = await signToken({ otpId: otp.id, ...(devCode ? {} : { texted: "1" }) }, "10m");

  // `devCode` only while no SMS provider is configured — the app then says
  // plainly that nothing was texted rather than "we texted you".
  return NextResponse.json({ requestToken, sent: !devCode, ...(devCode ? { devCode } : {}) });
}
