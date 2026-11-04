// Thin SMS provider interface with a console/dev driver (CLAUDE.md §Stack).
// Rules enforced HERE, not at call sites (CLAUDE.md §Compliance 5):
// sender = engineer trading name; marketing SMS end "Reply STOP to opt out";
// opt-outs honoured platform-wide; no sends 20:00–08:00 (queued instead).
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { brandName } from "@/lib/engineer";
import type { MessageClass } from "@/lib/generated/prisma/enums";
import { isSuppressed } from "@/lib/suppression";
import { sendPushNotification } from "@/lib/push";
import { sendWhatsApp, whatsappReady } from "@/lib/whatsapp";
import { templateForFixedText, type WhatsAppMessage } from "@/lib/whatsapp-templates";
import { twilioAuth } from "@/lib/twilio-auth";

// Texts come from the "TradeSura" sender name, which is one-way: a reply
// to it goes nowhere. The platform's number (the inbound STOP webhook's
// target, app/api/webhooks/sms-inbound) is the one that can take a reply,
// so the compliance line names it, as Matt worded it (3 Nov).
const STOP_SUFFIX = process.env.TWILIO_SMS_NUMBER
  ? `Reply STOP to ${ukNational(process.env.TWILIO_SMS_NUMBER)}`
  : "Reply STOP to opt out";

// +447366234255 → 07366 234255, the way people write a UK mobile.
function ukNational(e164: string): string {
  const m = /^\+44(\d{4})(\d{6})$/.exec(e164.replace(/\s+/g, ""));
  return m ? `0${m[1]} ${m[2]}` : e164;
}
export const QUIET_START_HOUR = 20; // inclusive
export const QUIET_END_HOUR = 8; // exclusive

// Matt, 4 Nov: automatic texts only go out 8am–8pm, London time (Vercel's
// clock is UTC), and anything triggered outside that waits until 8am. Codes
// someone has just asked for aren't held (sendVerificationCode,
// sendPlatformText).
function londonClock(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(d)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
  // London's offset from UTC right now (0 in winter, an hour in summer).
  const offsetMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
  return { ...p, offsetMs };
}

export function nextAllowedSendTime(now: Date): Date {
  const l = londonClock(now);
  if (l.hour >= QUIET_END_HOUR && l.hour < QUIET_START_HOUR) return now;
  const day = l.hour >= QUIET_START_HOUR ? l.day + 1 : l.day;
  return new Date(Date.UTC(l.year, l.month - 1, day, QUIET_END_HOUR, 0, 0) - l.offsetMs);
}


/** Whether texts really go out (Twilio's keys are set); without them, sends only reach the dev driver. */
export function smsConfigured(): boolean {
  return Boolean(twilioAuth() && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_SMS_NUMBER));
}

/**
 * Where Twilio reports what happened to each OutboundSms text
 * (app/api/webhooks/sms-status): delivered, or failed. Twilio can only call a
 * public https address, so there's none on a laptop.
 */
export function smsStatusCallbackUrl(): string | null {
  const base = appUrl();
  if (!base.startsWith("https://")) return null;
  // Without the Auth Token, Twilio can't sign, so the address carries the
  // secret key (lib/twilio-signature.ts).
  const key = process.env.TWILIO_WEBHOOK_KEY;
  return `${base}/api/webhooks/sms-status${key ? `?key=${encodeURIComponent(key)}` : ""}`;
}

/** What happened when a text was handed over: Twilio's message ID, or why it didn't go. */
type Delivery = { ok: true; sid: string | null } | { ok: false; reason: "not_configured" | "refused" };

// `fromLongCode: true` sends from the shared Twilio number (TWILIO_SMS_NUMBER)
// instead of an alphanumeric sender — used for anything that might need a
// reply (currently just the platform-sent OTP code, which shares its number
// with the inbound STOP webhook so the compliance line above points somewhere
// real).
// `ok` says whether the message actually went out via Twilio — false means it
// only hit the console.log dev driver (or Twilio refused it), which callers
// can use to decide whether it's safe to hand the plaintext code/link back to
// the client (see sendVerificationCode below), and to say truthfully whether
// a text went (QA-05). `statusCallback` asks Twilio to report delivery.
async function deliver(
  senderName: string,
  to: string,
  body: string,
  opts: { fromLongCode?: boolean; statusCallback?: string | null } = {},
): Promise<Delivery> {
  const auth = twilioAuth();
  const fromNumber = process.env.TWILIO_SMS_NUMBER;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!auth || !smsConfigured()) {
    // Dev driver. Real provider keys are a human task.
    if (process.env.NODE_ENV === "development") {
      console.log(`[SMS] from="${senderName}" to=${to}\n      ${body}`);
    }
    return { ok: false, reason: "not_configured" };
  }

  // Matt, 3 Nov: every text goes through the Messaging Service, so it shows
  // "TradeSura" as the sender, with the 07366 number behind it for STOP
  // replies. Engineer texts name the engineer in the wording instead
  // (CLAUDE.md compliance 5). Without a service: the number for TradeSura's
  // own texts, the sender name for the rest.
  const params = new URLSearchParams({ To: to, Body: body });
  if (service) params.set("MessagingServiceSid", service);
  else params.set("From", opts.fromLongCode && fromNumber ? fromNumber : "TradeSura");
  if (opts.statusCallback) params.set("StatusCallback", opts.statusCallback);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: auth.authorization,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    console.error(`[SMS] Twilio send to ${to} failed (${res.status}): ${await res.text()}`);
    return { ok: false, reason: "refused" };
  }
  const sid = ((await res.json().catch(() => null)) as { sid?: unknown } | null)?.sid;
  return { ok: true, sid: typeof sid === "string" ? sid : null };
}

/** Records on the OutboundSms row what happened when it was handed over; Twilio's receipt fills in the rest. */
function recordDelivery(id: string, d: Delivery) {
  return prisma.outboundSms.update({
    where: { id },
    data: d.ok ? { providerSid: d.sid } : { failedAt: new Date(), failureReason: d.reason },
  });
}

// Signup-time phone verification code. Sent from the platform itself, not an
// engineer's trading name (no Engineer row exists yet at this point in the
// flow) — so this bypasses sendSms()'s engineer lookup, OutboundSms logging,
// and marketing-class rules (quiet hours / STOP suffix) entirely: it's a
// transactional code the user just asked for, not a marketing send.
// Returns `devCode` (the plaintext code) only when Twilio isn't configured,
// so callers can surface it in dev the same way /api/auth/request's devLink
// stands in for real email delivery — never once Twilio is really sending.
export async function sendVerificationCode(to: string, code: string): Promise<{ devCode?: string }> {
  const { ok: delivered } = await deliver(
    "TradeSura",
    to,
    `Your TradeSura verification code is ${code}. It expires in 10 minutes.`,
    { fromLongCode: true },
  );
  if (!delivered && process.env.NODE_ENV !== "development") {
    throw new Error("Verification text could not be delivered.");
  }
  return delivered ? {} : { devCode: code };
}

// A text the person just asked for, before any account exists (the claim
// page's "Send my code"). From the shared long code like the sign-up code;
// not marketing, so no quiet hours or STOP line. Returns whether Twilio sent it.
export async function sendPlatformText(to: string, body: string): Promise<boolean> {
  return (await deliver("TradeSura", to, body, { fromLongCode: true })).ok;
}

// Service notification to the engineer's own verified mobile (plan signup,
// payment issue, referral progress). Not a marketing send — no OutboundSms
// row, no STOP suffix, no quiet hours; it goes to the account holder about
// their own account. Sent from the shared long code so it comes from a real
// number. No-op if the engineer has no verified phone or Twilio is unset.
// Goes by WhatsApp instead when the installer opted in and the message's
// template is approved (`whatsapp`, or a fixed text matched to its
// template); a WhatsApp send that fails falls back to this text.
// Returns whether it went (QA-05); callers that don't care can ignore it.
export async function notifyEngineer(engineerId: string, body: string, whatsapp?: WhatsAppMessage): Promise<boolean> {
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { phone: true, whatsappOptInAt: true },
  });
  if (!engineer?.phone) return false;
  const fixed = templateForFixedText(body);
  const message = whatsapp ?? (fixed ? { template: fixed, vars: [] } : null);
  // Outside 8am–8pm the text waits on the queue until 8am (Matt, 4 Nov).
  const now = new Date();
  const sendAfter = nextAllowedSendTime(now);
  if (sendAfter > now) {
    await prisma.outboundSms.create({
      data: { engineerId, toPhone: engineer.phone, senderName: "TradeSura", body, class: "TRANSACTIONAL", consentBasis: "engineer-account", sendAfter },
    });
    return false;
  }
  if (engineer.whatsappOptInAt && message && whatsappReady(message.template)) {
    if (await sendWhatsApp(engineer.phone, message)) return true;
  }
  return (await deliver("TradeSura", engineer.phone, body, { fromLongCode: true })).ok;
}

// A text to TradeSura's own team (the card-upload alert, lib/card-alert.ts),
// from the shared long code: not an engineer or customer, so no OutboundSms
// row, STOP line or quiet hours. Returns whether it went.
export async function textStaff(to: string, body: string): Promise<boolean> {
  return (await deliver("TradeSura", to, body, { fromLongCode: true })).ok;
}

export async function sendSms(opts: {
  engineerId: string;
  to: string;
  body: string;
  messageClass: MessageClass;
  // plan-member-transactional | engineer-initiated | marketing
  consentBasis?: string;
  sendAfter?: Date; // for scheduled nudges
  cancelKey?: string;
}) {
  const engineer = await prisma.engineer.findUniqueOrThrow({
    where: { id: opts.engineerId },
    select: { tradingName: true, slug: true },
  });
  const senderName = brandName(engineer);

  let body = opts.body;
  if (opts.messageClass === "MARKETING") {
    // Per-book flag OR the platform-wide suppression store.
    const optedOut =
      (await prisma.customer.findFirst({ where: { phone: opts.to, smsOptOut: true } })) ||
      (await isSuppressed("sms", opts.to));
    if (optedOut) return { sent: false, reason: "opted-out" as const };
    if (!body.includes(STOP_SUFFIX)) body = `${body} ${STOP_SUFFIX}`;
  }

  const consentBasis =
    opts.consentBasis ??
    (opts.messageClass === "MARKETING" ? "marketing" : "engineer-initiated");

  // Quiet hours apply to every text here, not just marketing (Matt, 4 Nov).
  const now = new Date();
  let sendAfter = opts.sendAfter ?? now;
  const allowed = nextAllowedSendTime(sendAfter < now ? now : sendAfter);
  if (allowed > sendAfter) sendAfter = allowed;

  const row = await prisma.outboundSms.create({
    data: {
      engineerId: opts.engineerId,
      toPhone: opts.to,
      senderName,
      body,
      class: opts.messageClass,
      consentBasis,
      sendAfter,
      cancelKey: opts.cancelKey,
      ...(sendAfter <= now ? { status: "SENT" as const, sentAt: now } : {}),
    },
  });
  // `sent`: not held for later. `delivered`: whether it went out now (null while
  // queued). A refusal is kept on the row, as is Twilio's ID for its receipt.
  if (row.status !== "SENT") return { sent: false, delivered: null, id: row.id };
  const delivery = await deliver(senderName, opts.to, body, { statusCallback: smsStatusCallbackUrl() });
  await recordDelivery(row.id, delivery);
  return { sent: true, delivered: delivery.ok, id: row.id };
}

// Flush due queued messages (dev: called from /api/jobs/flush-sms).
// ponytail: manual flush + dev interval; swap for a cron/queue when deployed
export async function flushSmsQueue() {
  const due = await prisma.outboundSms.findMany({
    where: { status: "QUEUED", sendAfter: { lte: new Date() } },
  });
  for (const sms of due) {
    const delivery = await deliver(sms.senderName, sms.toPhone, sms.body, { statusCallback: smsStatusCallbackUrl() });
    await prisma.outboundSms.update({
      where: { id: sms.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    await recordDelivery(sms.id, delivery);
    // Part 11 — "services come due": the engineer hears once per plan, when
    // the first (30-day) reminder goes out, not on every follow-up.
    const svc = sms.cancelKey?.match(/^svc:(.+):30$/);
    if (svc) await pushServiceDue(svc[1]);
  }
  return due.length;
}

// Prefix match: "nudge:<planId>" and "svc:<planId>" cancel their whole family.
export async function cancelScheduledSms(cancelKeyPrefix: string) {
  await prisma.outboundSms.updateMany({
    where: { cancelKey: { startsWith: cancelKeyPrefix }, status: "QUEUED" },
    data: { status: "CANCELLED" },
  });
}

async function pushServiceDue(planId: string) {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
    select: { engineerId: true, customerId: true, customer: { select: { firstName: true, lastName: true } } },
  });
  if (!plan) return;
  const name = `${plan.customer.firstName} ${plan.customer.lastName}`;
  await sendPushNotification(
    plan.engineerId,
    "Service coming due",
    `${name}'s annual service is due in 30 days — we've texted them to book it in.`,
    { url: `/customer/${plan.customerId}` },
  );
}
