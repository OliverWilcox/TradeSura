import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { suppress, unsuppress } from "@/lib/suppression";

// Twilio's request-signing algorithm: HMAC-SHA1, keyed by the Auth Token, of
// the exact webhook URL with every POST param's key+value appended in
// alphabetical order — see https://www.twilio.com/docs/usage/security.
// The URL must match byte-for-byte what's configured in the Twilio console,
// so this trusts req.url as-is rather than reconstructing it.
function verifyTwilioSignature(url: string, params: URLSearchParams, signature: string, authToken: string) {
  const sorted = [...params.keys()].sort();
  const data = sorted.reduce((acc, key) => acc + key + params.get(key), url);
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "YES", "UNSTOP"]);

const twiml = (body?: string) =>
  new NextResponse(body ? `<Response><Message>${body}</Message></Response>` : "<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

// Twilio's target for the shared long code (TWILIO_SMS_NUMBER) — the only
// number the platform's SMS actually goes out from that can receive a reply
// (see lib/sms.ts's STOP_SUFFIX). Configure this URL as the number's
// "A message comes in" webhook in the Twilio console.
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature");
  const rawBody = await req.text();

  if (!authToken || !signature) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  const params = new URLSearchParams(rawBody);
  if (!verifyTwilioSignature(req.url, params, signature, authToken)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 403 });
  }

  const from = params.get("From");
  const keyword = (params.get("Body") ?? "").trim().toUpperCase();
  if (!from) return twiml();

  // Customer.phone is scoped per-engineer (@@unique([engineerId, phone])),
  // so the same mobile number can belong to more than one engineer's book —
  // opt-outs are honoured platform-wide (CLAUDE.md §Compliance 5), so every
  // matching row gets updated, not just one.
  if (STOP_KEYWORDS.has(keyword)) {
    await prisma.customer.updateMany({ where: { phone: from }, data: { smsOptOut: true } });
    await suppress("sms", from, "sms_stop");
    await track("sms_opted_out", { type: "CUSTOMER" }, { phone: from });
    return twiml("You've been unsubscribed from TradeSura care plan texts. Reply START to resubscribe.");
  }
  if (START_KEYWORDS.has(keyword)) {
    await prisma.customer.updateMany({ where: { phone: from }, data: { smsOptOut: false } });
    await unsuppress("sms", from);
    await track("sms_opted_in", { type: "CUSTOMER" }, { phone: from });
    return twiml("You're resubscribed to TradeSura care plan texts.");
  }
  return twiml();
}
