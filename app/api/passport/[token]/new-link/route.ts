import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { sendPlatformText } from "@/lib/sms";
import { PASSPORT_LINK_DAYS, passportUrl } from "@/lib/passport-link";
import { maskedMobile, passportPhones } from "@/lib/passport-session";

const NEW_LINK_EVERY_MS = 10 * 60 * 1000;

// "Text me a new link" on an expired passport link: a fresh one goes to the
// mobile(s) on file, never to whoever asked, so an old forwarded link can't
// be turned into access. At most one every 10 minutes per home, so it can't
// be used to bother the homeowner.
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const passport = await prisma.homePassport.findUnique({ where: { viewToken: token }, select: { id: true } });
  if (!passport) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const phones = await passportPhones(passport.id);
  if (phones.length === 0) {
    return NextResponse.json({ error: "We don't have a mobile for this home. Ask your engineer to send you a new link." }, { status: 409 });
  }
  const scope = `passport-link:${passport.id}`;
  const last = await prisma.signInCode.findFirst({ where: { engineerId: scope }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < NEW_LINK_EVERY_MS) {
    return NextResponse.json({ ok: true, sentTo: phones.map(maskedMobile) });
  }
  await prisma.signInCode.create({
    data: { engineerId: scope, channel: "passport-link", codeHash: "", expiresAt: new Date(Date.now() + NEW_LINK_EVERY_MS) },
  });
  const body = `Here's a new link to your Home Passport, from TradeSura: ${passportUrl(token)} It works for ${PASSPORT_LINK_DAYS} days.`;
  for (const phone of phones) await sendPlatformText(phone, body);
  await track("passport_link_resent", { type: "CUSTOMER" }, { passportId: passport.id });
  return NextResponse.json({ ok: true, sentTo: phones.map(maskedMobile) });
}
