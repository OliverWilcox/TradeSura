// Thin SMS provider interface with a console/dev driver (CLAUDE.md §Stack).
// Rules enforced HERE, not at call sites (CLAUDE.md §Compliance 5):
// sender = engineer trading name; marketing SMS end "Reply STOP to opt out";
// opt-outs honoured platform-wide; no sends 20:00–08:00 (queued instead).
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import type { MessageClass } from "@/lib/generated/prisma/enums";
import { isSuppressed } from "@/lib/suppression";
import { sendPushNotification } from "@/lib/push";

// Alphanumeric sender IDs (used below for every engineer-branded send) are
// one-way on real networks — Twilio's own STOP-keyword filtering doesn't
// apply to them, so "reply STOP" to a trading name is a dead end. The
// platform's shared long code (also the inbound STOP webhook's target,
// see app/api/webhooks/sms-inbound) is the only number that can actually
// receive a reply, so the compliance line points there instead.
const STOP_SUFFIX = process.env.TWILIO_SMS_NUMBER
  ? `Text STOP to ${process.env.TWILIO_SMS_NUMBER} to opt out`
  : "Reply STOP to opt out";
export const QUIET_START_HOUR = 20; // inclusive
export const QUIET_END_HOUR = 8; // exclusive

// ponytail: server-local clock; pin to Europe/London when deployed off a UK machine
export function nextAllowedSendTime(now: Date): Date {
  const h = now.getHours();
  if (h >= QUIET_END_HOUR && h < QUIET_START_HOUR) return now;
  const next = new Date(now);
  if (h >= QUIET_START_HOUR) next.setDate(next.getDate() + 1);
  next.setHours(QUIET_END_HOUR, 0, 0, 0);
  return next;
}

// GSM alphanumeric sender IDs: letters/digits only, 11 characters max, at
// least one letter. Engineer trading names routinely blow past that
// ("Akhtar Heating & Plumbing"), so this is a display-name approximation,
// not the real thing — good enough for a doorstep SMS, not for anything
// that needs the full name to round-trip.
function alphanumericSenderId(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 11);
  return /[a-zA-Z]/.test(cleaned) ? cleaned : "TradeSura";
}

// `fromLongCode: true` sends from the shared Twilio number (TWILIO_SMS_NUMBER)
// instead of an alphanumeric sender — used for anything that might need a
// reply (currently just the platform-sent OTP code, which shares its number
// with the inbound STOP webhook so the compliance line above points somewhere
// real).
// Returns whether the message actually went out via Twilio — false means it
// only hit the console.log dev driver, which callers can use to decide
// whether it's safe to hand the plaintext code/link back to the client (see
// sendVerificationCode below).
async function deliver(
  senderName: string,
  to: string,
  body: string,
  opts: { fromLongCode?: boolean } = {},
): Promise<boolean> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_SMS_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    // Dev driver. Real provider keys are a human task.
    if (process.env.NODE_ENV === "development") {
      console.log(`[SMS] from="${senderName}" to=${to}\n      ${body}`);
    }
    return false;
  }

  const from = opts.fromLongCode ? fromNumber : alphanumericSenderId(senderName);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  if (!res.ok) {
    console.error(`[SMS] Twilio send to ${to} failed (${res.status}): ${await res.text()}`);
    return false;
  }
  return true;
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
  const delivered = await deliver(
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

// Service notification to the engineer's own verified mobile (plan signup,
// payment issue, referral progress). Not a marketing send — no OutboundSms
// row, no STOP suffix, no quiet hours; it goes to the account holder about
// their own account. Sent from the shared long code so it comes from a real
// number. No-op if the engineer has no verified phone or Twilio is unset.
export async function notifyEngineer(engineerId: string, body: string) {
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { phone: true },
  });
  if (!engineer?.phone) return;
  await deliver("TradeSura", engineer.phone, body, { fromLongCode: true });
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

  const now = new Date();
  let sendAfter = opts.sendAfter ?? now;
  if (opts.messageClass === "MARKETING") {
    const allowed = nextAllowedSendTime(sendAfter < now ? now : sendAfter);
    if (allowed > sendAfter) sendAfter = allowed;
  }

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
  if (row.status === "SENT") await deliver(senderName, opts.to, body);
  return { sent: row.status === "SENT", id: row.id };
}

// Flush due queued messages (dev: called from /api/jobs/flush-sms).
// ponytail: manual flush + dev interval; swap for a cron/queue when deployed
export async function flushSmsQueue() {
  const due = await prisma.outboundSms.findMany({
    where: { status: "QUEUED", sendAfter: { lte: new Date() } },
  });
  for (const sms of due) {
    await deliver(sms.senderName, sms.toPhone, sms.body);
    await prisma.outboundSms.update({
      where: { id: sms.id },
      data: { status: "SENT", sentAt: new Date() },
    });
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
