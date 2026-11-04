import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { twilioWebhookCheck } from "@/lib/twilio-signature";

// Replies to the automated WhatsApp number (lib/whatsapp.ts). Configure this
// URL as the WhatsApp sender's "incoming message" webhook in Twilio. Nobody
// reads this number, so STOP/START change the installer's opt-in and
// anything else gets pointed at the support number, which a person answers.
const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP"]);

const twiml = (body?: string) =>
  new NextResponse(body ? `<Response><Message>${body}</Message></Response>` : "<Response></Response>", {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });

export async function POST(req: Request) {
  const params = new URLSearchParams(await req.text());
  const check = twilioWebhookCheck([req.url], params, req.headers.get("x-twilio-signature"));
  if (check === "not_configured") return NextResponse.json({ error: "not configured" }, { status: 500 });
  if (check === "forbidden") return NextResponse.json({ error: "invalid signature" }, { status: 403 });

  // Twilio sends WhatsApp senders as "whatsapp:+447…".
  const phone = (params.get("From") ?? "").replace(/^whatsapp:/, "");
  if (!phone) return twiml();
  const keyword = (params.get("Body") ?? "").trim().toUpperCase();
  const engineer = await prisma.engineer.findUnique({ where: { phone }, select: { id: true } });

  if (STOP_WORDS.has(keyword)) {
    if (engineer) {
      await prisma.engineer.update({ where: { id: engineer.id }, data: { whatsappOptInAt: null } });
      await track("whatsapp_opted_out", { type: "ENGINEER", id: engineer.id }, { via: "whatsapp_stop" });
    }
    return twiml("You won't get TradeSura updates on WhatsApp any more. We'll text you instead. Reply START to switch back.");
  }
  if (START_WORDS.has(keyword) && engineer) {
    await prisma.engineer.update({ where: { id: engineer.id }, data: { whatsappOptInAt: new Date() } });
    await track("whatsapp_opted_in", { type: "ENGINEER", id: engineer.id }, { via: "whatsapp_start" });
    return twiml("You're back on TradeSura updates by WhatsApp.");
  }
  // No message text in the log: it can hold anything, and nobody works this inbox.
  await track("whatsapp_inbound", engineer ? { type: "ENGINEER", id: engineer.id } : { type: "SYSTEM" }, {});
  return twiml("This number only sends TradeSura updates. For help, WhatsApp or call us on 0330 223 8456.");
}
