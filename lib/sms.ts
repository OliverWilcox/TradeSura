// Thin SMS provider interface with a console/dev driver (CLAUDE.md §Stack).
// Rules enforced HERE, not at call sites (CLAUDE.md §Compliance 5):
// sender = engineer trading name; marketing SMS end "Reply STOP to opt out";
// opt-outs honoured platform-wide; no sends 20:00–08:00 (queued instead).
import { prisma } from "@/lib/db";
import type { MessageClass } from "@/lib/generated/prisma/enums";

const STOP_SUFFIX = "Reply STOP to opt out";
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

function deliver(senderName: string, to: string, body: string) {
  // Dev driver. Real provider keys are a human task.
  console.log(`[SMS] from="${senderName}" to=${to}\n      ${body}`);
}

export async function sendSms(opts: {
  engineerId: string;
  to: string;
  body: string;
  messageClass: MessageClass;
  sendAfter?: Date; // for scheduled nudges
  cancelKey?: string;
}) {
  const engineer = await prisma.engineer.findUniqueOrThrow({
    where: { id: opts.engineerId },
    select: { tradingName: true, slug: true },
  });
  const senderName = engineer.tradingName ?? engineer.slug;

  let body = opts.body;
  if (opts.messageClass === "MARKETING") {
    if (
      await prisma.customer.findFirst({ where: { phone: opts.to, smsOptOut: true } })
    ) {
      return { sent: false, reason: "opted-out" as const };
    }
    if (!body.includes(STOP_SUFFIX)) body = `${body} ${STOP_SUFFIX}`;
  }

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
      sendAfter,
      cancelKey: opts.cancelKey,
      ...(sendAfter <= now ? { status: "SENT" as const, sentAt: now } : {}),
    },
  });
  if (row.status === "SENT") deliver(senderName, opts.to, body);
  return { sent: row.status === "SENT", id: row.id };
}

// Flush due queued messages (dev: called from /api/jobs/flush-sms).
// ponytail: manual flush + dev interval; swap for a cron/queue when deployed
export async function flushSmsQueue() {
  const due = await prisma.outboundSms.findMany({
    where: { status: "QUEUED", sendAfter: { lte: new Date() } },
  });
  for (const sms of due) {
    deliver(sms.senderName, sms.toPhone, sms.body);
    await prisma.outboundSms.update({
      where: { id: sms.id },
      data: { status: "SENT", sentAt: new Date() },
    });
  }
  return due.length;
}

export async function cancelScheduledSms(cancelKey: string) {
  await prisma.outboundSms.updateMany({
    where: { cancelKey, status: "QUEUED" },
    data: { status: "CANCELLED" },
  });
}
