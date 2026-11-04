import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { grantPassportSession } from "@/lib/passport-session";
import { verifyContactCode, VerificationError } from "@/lib/contact-verification";

const Body = z.object({ requestToken: z.string().min(1), code: z.string().trim() });

// The code from "Text me a code": right, and this browser can see the
// passport for a while (lib/passport-session.ts); wrong five times and the
// number is locked for 15 minutes (lib/contact-verification.ts).
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the four-digit code." }, { status: 400 });
  const passport = await prisma.homePassport.findUnique({ where: { viewToken: token }, select: { id: true } });
  if (!passport) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    const proof = await verifyContactCode(parsed.data.requestToken, parsed.data.code, "passport-sms");
    if (proof.passportId !== passport.id) throw new VerificationError("Request a new code.");
    await grantPassportSession(passport.id);
    await track("passport_unlocked", { type: "CUSTOMER" }, { passportId: passport.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof VerificationError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
