import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { passportLinkState } from "@/lib/passport-link";
import { maskedMobile, passportPhones } from "@/lib/passport-session";
import { requestContactCode, VerificationError } from "@/lib/contact-verification";

const Body = z.object({ e: z.string().optional(), s: z.string().optional(), choice: z.number().int().min(0).max(5).optional() });

// Matt, 4 Nov — "Text me a code" on the passport link. Only from a link that
// is still in date; the code goes to a mobile already on file, so whoever
// holds a forwarded link gets no further than this.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Try again." }, { status: 400 });
  const passport = await prisma.homePassport.findUnique({ where: { viewToken: token }, select: { id: true } });
  if (!passport) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (passportLinkState(token, parsed.data.e, parsed.data.s) !== "ok") {
    return NextResponse.json({ error: "This link has expired.", code: "expired" }, { status: 410 });
  }
  const phones = await passportPhones(passport.id);
  const phone = phones[parsed.data.choice ?? 0];
  if (!phone) {
    return NextResponse.json({ error: "We don't have a mobile for this home. Ask your engineer to send you a new link." }, { status: 409 });
  }
  try {
    const sent = await requestContactCode("passport-sms", phone, { passportId: passport.id, phone });
    return NextResponse.json({ requestToken: sent.requestToken, sentTo: maskedMobile(phone), ...(sent.devCode ? { devCode: sent.devCode } : {}) });
  } catch (e) {
    if (e instanceof VerificationError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
