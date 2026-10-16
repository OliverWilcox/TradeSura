import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/auth";
import { track } from "@/lib/track";
import { normaliseUkPhone } from "@/lib/phone";
import { requestContactCode, verifyContactCode, VerificationError } from "@/lib/contact-verification";
const Body = z.object({ action: z.enum(["request", "verify"]), channel: z.enum(["email", "sms"]), email: z.string().email().transform(s => s.trim().toLowerCase()), phone: z.string(), emailToken: z.string().optional(), requestToken: z.string().optional(), code: z.string().optional() });
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your email and mobile number." }, { status: 400 });
  const b = parsed.data, phone = normaliseUkPhone(b.phone);
  if (!phone) return NextResponse.json({ error: "Enter a valid UK mobile number." }, { status: 400 });
  try {
    if (b.channel === "sms") {
      const proof = await verifyToken(b.emailToken ?? "");
      if (proof?.emailVerified !== "1" || proof.email !== b.email || proof.phone !== phone) throw new VerificationError("Verify your email first.");
    }
    const purpose = b.channel === "email" ? "signup-email" : "signup-sms";
    if (b.action === "request") {
      // Coded, so the app puts these under the right field with a Sign in link.
      if (await prisma.engineer.findUnique({ where: { email: b.email } })) {
        return NextResponse.json({ error: "This email already has an account — sign in instead.", code: "email_taken", field: "email" }, { status: 409 });
      }
      if (await prisma.engineer.findUnique({ where: { phone } })) {
        return NextResponse.json({ error: "This mobile is already registered. Sign in instead?", code: "phone_taken", field: "phone" }, { status: 409 });
      }
      return NextResponse.json(await requestContactCode(purpose, b.channel === "email" ? b.email : phone, { email: b.email, phone }));
    }
    const proof = await verifyContactCode(b.requestToken ?? "", b.code ?? "", purpose);
    if (proof.email !== b.email || proof.phone !== phone) throw new VerificationError("Your details changed — request a new code.");
    // verified is the legacy onboarding capability, not a claim that SMS was sent.
    const token = await signToken({ verified: "1", emailVerified: "1", email: b.email, phone, ...(b.channel === "sms" ? { texted: "1" } : {}) }, "30m");
    await track("signup_contact_verified", { type: "SYSTEM" }, { channel: b.channel });
    return NextResponse.json({ phoneToken: token, emailToken: token, texted: b.channel === "sms" });
  } catch (e) {
    if (e instanceof VerificationError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Verification is unavailable — please try again." }, { status: 503 });
  }
}
