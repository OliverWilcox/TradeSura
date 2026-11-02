import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { appUrl } from "@/lib/app-url";
import { sendPlatformText } from "@/lib/sms";
import { claimAppLink, claimAppToken, claimForPage, claimLookupLimited, claimText, requestIp } from "@/lib/claim";

// 30 Oct update §1.4 — "Send my code" texts their claim code plus a personal
// link ("Tap here once the app's installed") to the mobile they just gave,
// with their consent. At most once a minute per code.
const RESEND_AFTER_MS = 60 * 1000;

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  if (await claimLookupLimited(requestIp(req.headers))) {
    return NextResponse.json({ error: "Too many tries. Wait a few minutes and try again." }, { status: 429 });
  }
  const row = await claimForPage((await params).code);
  if (!row) return NextResponse.json({ error: "That code isn't recognised." }, { status: 404 });
  if (!row.claimedAt || !row.mobile || !row.textConsentAt) {
    return NextResponse.json({ error: "Confirm your details first." }, { status: 400 });
  }
  const now = new Date();
  if (row.codeTextedAt && now.getTime() - row.codeTextedAt.getTime() < RESEND_AFTER_MS) {
    // Already on its way: carry on to the store rather than stopping them.
    return NextResponse.json({ ok: true, alreadySent: true });
  }
  // Only ever to the mobile they confirmed, never one given now.
  const link = claimAppLink(appUrl(), row.code, await claimAppToken(row.code));
  const sent = await sendPlatformText(row.mobile, claimText(row.code, link));
  await prisma.claimCode.update({ where: { code: row.code }, data: { codeTextedAt: now } });
  await track("claim_step", { type: "SYSTEM" }, { code: row.code, step: "code_texted", delivered: sent, variantCell: row.variantCell });
  return NextResponse.json({ ok: true });
}
