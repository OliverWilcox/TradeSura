import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { smsStatusCallbackUrl } from "@/lib/sms";
import { verifyTwilioSignature } from "@/lib/twilio-signature";

// Twilio's delivery receipts (QA-02): lib/sms.ts gives each text this URL as
// its StatusCallback, and Twilio posts here as the text moves on (queued,
// sent, delivered, undelivered, failed). Delivered and failed are kept on the
// OutboundSms row, found by Twilio's message ID; the rest change nothing.
// Twilio signs the URL it was given, so that's what's checked (req.url can
// differ behind a proxy), falling back to req.url.

const FAILED = new Set(["undelivered", "failed"]);

export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature");
  if (!authToken) return NextResponse.json({ error: "not configured" }, { status: 500 });
  // Twilio always signs, so a request without a signature isn't Twilio's (QA-24).
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 403 });
  const params = new URLSearchParams(await req.text());
  const signedUrls = [smsStatusCallbackUrl(), req.url].filter((u): u is string => !!u);
  if (!signedUrls.some((url) => verifyTwilioSignature(url, params, signature, authToken))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  const sid = params.get("MessageSid");
  const status = params.get("MessageStatus");
  if (!sid || !status) return new NextResponse(null, { status: 204 });
  const now = new Date();
  if (status === "delivered") {
    // A late "delivered" after a failure means it arrived after all.
    await prisma.outboundSms.updateMany({ where: { providerSid: sid, deliveredAt: null }, data: { deliveredAt: now, failedAt: null, failureReason: null } });
  } else if (FAILED.has(status)) {
    await prisma.outboundSms.updateMany({
      where: { providerSid: sid, deliveredAt: null, failedAt: null },
      data: { failedAt: now, failureReason: params.get("ErrorCode") ? `twilio_${params.get("ErrorCode")}` : status },
    });
  }
  return new NextResponse(null, { status: 204 });
}
