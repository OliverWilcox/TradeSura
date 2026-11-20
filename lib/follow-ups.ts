import { prisma } from "@/lib/db";
import { sendPushNotification } from "@/lib/push";
import { notifyEngineer } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/email-layout";
import { accountEmail } from "@/lib/account-emails";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp-templates";
import { CALL_LADDER, daysBetween, ladderStep, lastDeliveredOffers, realEngineerWhere, testMarks, type LadderStep } from "@/lib/admin/metrics";

export const FOLLOW_UP_EVENT = "follow_up_sent";

export const FOLLOW_UP_COPY = {
  push: {
    title: "Your next customer is one tap away",
    body: "No plan offers for a few days. On your next job, tap Offer a plan and let the app do the selling.",
  },
  whatsapp: WHATSAPP_TEMPLATES.no_activity.text,
  email: (firstName: string | null) =>
    accountEmail({
      firstName,
      title: "A week without a plan offer",
      preheader: "Every job is a chance to add a customer.",
      paragraphs: [
        "Your plans are live, but no customer has been offered one this week. The engineers earning most on TradeSura offer a plan on every job: pick the reason for the visit, hand over your phone and the app does the selling.",
        `Want a hand with what to say? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#1F5EFF;">${SUPPORT_EMAIL}</a> and we'll call you.`,
      ],
      button: { to: "offer", label: "Offer a plan" },
    }),
} as const;

type Candidate = {
  id: string;
  email: string | null;
  firstName: string | null;
  gasSafeVerifiedAt: Date | null;
  expoPushToken: string | null;
  phone: string | null;
};

export type FollowUpSend = { engineerId: string; step: number; channel: LadderStep["channel"]; from: string; went: boolean };

export function dueFollowUp(days: number, sentSteps: number[]): LadderStep | null {
  const step = ladderStep(days);
  if (!step || step.channel === "call") return null;
  return sentSteps.some((s) => s >= step.step) ? null : step;
}

async function sendStep(e: Candidate, step: LadderStep): Promise<boolean> {
  switch (step.channel) {
    case "push":
      if (!e.expoPushToken) return false;
      await sendPushNotification(e.id, FOLLOW_UP_COPY.push.title, FOLLOW_UP_COPY.push.body, { url: "/customers" });
      return true;
    case "whatsapp":
      if (!e.phone) return false;
      return notifyEngineer(e.id, FOLLOW_UP_COPY.whatsapp, { template: "no_activity", vars: [] });
    case "email": {
      if (!e.email) return false;
      const mail = FOLLOW_UP_COPY.email(e.firstName);
      await sendEmail({ to: e.email, subject: mail.subject, html: mail.html, replyTo: SUPPORT_EMAIL });
      return true;
    }
    default:
      return false;
  }
}

export async function runFollowUpLadder(now = new Date()): Promise<FollowUpSend[]> {
  const marks = await testMarks();
  const engineers: Candidate[] = await prisma.engineer.findMany({
    where: { ...realEngineerWhere(marks), ownerId: null, gasSafeVerifiedAt: { not: null }, bannedAt: null, pausedAt: null, leftAt: null },
    select: { id: true, email: true, firstName: true, gasSafeVerifiedAt: true, expoPushToken: true, phone: true },
  });
  if (!engineers.length) return [];
  const lastOffer = await lastDeliveredOffers(marks, engineers.map((e) => e.id));
  const minDays = CALL_LADDER[0].fromDays;
  const sends: FollowUpSend[] = [];
  for (const e of engineers) {
    const from = lastOffer.get(e.id) ?? e.gasSafeVerifiedAt!;
    const days = daysBetween(from, now);
    if (days < minDays) continue;
    const fromKey = from.toISOString();
    const already = await prisma.event.findMany({
      where: { name: FOLLOW_UP_EVENT, meta: { path: ["engineerId"], equals: e.id } },
      select: { meta: true },
    });
    const sentSteps = already.filter((ev) => (ev.meta as { from?: string }).from === fromKey).map((ev) => Number((ev.meta as { step?: number }).step ?? 0));
    const step = dueFollowUp(days, sentSteps);
    if (!step) continue;
    const send: FollowUpSend = { engineerId: e.id, step: step.step, channel: step.channel, from: fromKey, went: false };
    const event = await prisma.event.create({ data: { name: FOLLOW_UP_EVENT, actorType: "SYSTEM", meta: { ...send, days } } });
    try {
      send.went = await sendStep(e, step);
    } catch (err) {
      console.error(`[follow-ups] step ${step.step} (${step.channel}) for ${e.id} failed:`, err);
    }
    if (send.went) await prisma.event.update({ where: { id: event.id }, data: { meta: { ...send, days } } });
    sends.push(send);
  }
  return sends;
}

export async function followUpsSent(engineerId: string) {
  const events = await prisma.event.findMany({
    where: { name: FOLLOW_UP_EVENT, meta: { path: ["engineerId"], equals: engineerId } },
    orderBy: { ts: "desc" },
    select: { ts: true, meta: true },
  });
  return events.map((ev) => {
    const m = ev.meta as { step: number; channel: LadderStep["channel"]; from: string; went?: boolean };
    return { step: m.step, channel: m.channel, label: CALL_LADDER.find((s) => s.step === m.step)?.label ?? m.channel, at: ev.ts.toISOString(), from: m.from, went: m.went === true };
  });
}
