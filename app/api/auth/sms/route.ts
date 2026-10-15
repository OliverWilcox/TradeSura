import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normaliseUkPhone } from "@/lib/phone";
import { sessionToken } from "@/lib/sign-in-code";
import { smsAvailable, requestContactCode, verifyContactCode, VerificationError } from "@/lib/contact-verification";
const Body = z.object({ phone: z.string(), requestToken: z.string().optional(), code: z.string().optional() });
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const phone = parsed.success ? normaliseUkPhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) return NextResponse.json({ error: "Enter a valid UK mobile number." }, { status: 400 });
  try {
    if (!smsAvailable()) throw new VerificationError("Text sign-in is unavailable — use email instead.", 503);
    const engineer = await prisma.engineer.findUnique({ where: { phone } });
    if (!engineer?.smsSignInEnabled || !engineer.phoneVerifiedAt) throw new VerificationError("SMS sign-in isn't enabled for this number — use your email instead.");
    if (!parsed.data.requestToken) return NextResponse.json({ ...(await requestContactCode("signin-sms", phone, { accountId: engineer.id, phone })), maskedEmail: `mobile ending ${phone.slice(-4)}` });
    const proof = await verifyContactCode(parsed.data.requestToken, parsed.data.code ?? "", "signin-sms");
    if (proof.accountId !== engineer.id || proof.phone !== phone) throw new VerificationError("Request a new code for this number.");
    return NextResponse.json({ token: await sessionToken(engineer.id) });
  } catch (e) { return NextResponse.json({ error: e instanceof VerificationError ? e.message : "Couldn't sign in — try again." }, { status: e instanceof VerificationError ? e.status : 503 }); }
}
