import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getEngineerId } from "@/lib/auth";
import { smsAvailable, requestContactCode, verifyContactCode, VerificationError } from "@/lib/contact-verification";
const Body = z.object({ action: z.enum(["request", "verify", "disable"]), requestToken: z.string().optional(), code: z.string().optional() });
export async function POST(req: Request) {
  const id = await getEngineerId();
  if (!id) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check your request." }, { status: 400 });
  const b = parsed.data;
  try {
    const engineer = await prisma.engineer.findUnique({ where: { id } });
    if (!engineer) throw new VerificationError("Account not found.");
    if (b.action === "disable") {
      await prisma.engineer.update({ where: { id }, data: { smsSignInEnabled: false } });
      return NextResponse.json({ ok: true });
    }
    if (!smsAvailable() || !engineer.phone) throw new VerificationError("SMS setup is unavailable right now.", 503);
    if (b.action === "request") return NextResponse.json(await requestContactCode("enable-sms", engineer.phone, { accountId: id, phone: engineer.phone }));
    const proof = await verifyContactCode(b.requestToken ?? "", b.code ?? "", "enable-sms");
    if (proof.accountId !== id || proof.phone !== engineer.phone) throw new VerificationError("Your details changed — request a new code.");
    await prisma.engineer.update({ where: { id }, data: { smsSignInEnabled: true, phoneVerifiedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof VerificationError ? e.message : "Couldn't update SMS sign-in — try again." }, { status: e instanceof VerificationError ? e.status : 503 });
  }
}
