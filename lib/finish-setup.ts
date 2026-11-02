import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/email-layout";
import { finishSetupEmail } from "@/lib/account-emails";
import { sendPushNotification } from "@/lib/push";
import { track } from "@/lib/track";

// Matt, 30 Oct §9.1 — "Finish setup to get paid" is asked the moment the
// first customer joins, by push and email, with push chasers if it isn't
// done. "Done" = Stripe can pay the engineer out (stripePayoutsEnabled):
// until the stage-2 screens exist, that's finishing Stripe's own setup.
export const CHASER_DAYS = [1, 3, 7, 14] as const;
const DAY = 24 * 60 * 60 * 1000;
const PUSH_TITLE = "Finish setup to get paid";

async function askedAt(engineerId: string): Promise<Date | null> {
  const e = await prisma.event.findFirst({
    where: { name: "finish_setup_asked", meta: { path: ["engineerId"], equals: engineerId } },
    select: { ts: true },
  });
  return e?.ts ?? null;
}

/** Called when a plan goes live; does nothing unless this is the first customer and payouts are off. */
export async function askToFinishSetup(engineerId: string, customerName: string): Promise<boolean> {
  const engineer = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { email: true, firstName: true, stripePayoutsEnabled: true, ownerId: true },
  });
  if (!engineer || engineer.ownerId || engineer.stripePayoutsEnabled) return false;
  if (await askedAt(engineerId)) return false;
  // Recorded first, so a webhook retry never asks twice.
  await track("finish_setup_asked", { type: "SYSTEM" }, { engineerId });
  await sendPushNotification(engineerId, PUSH_TITLE, `${customerName} has joined. Finish your setup so we can pay you on Fridays.`, {
    url: "/get-paid",
  });
  if (engineer.email) {
    const email = finishSetupEmail(engineer.firstName, customerName);
    await sendEmail({ to: engineer.email, subject: email.subject, html: email.html, replyTo: SUPPORT_EMAIL }).catch((err) =>
      console.error("[finish-setup] email failed:", err),
    );
  }
  return true;
}

/** The chaser due now, if any: the latest of CHASER_DAYS that has passed and not been sent. */
export function dueChaser(askedOn: Date, sent: number[], now: Date): number | null {
  const days = Math.floor((now.getTime() - askedOn.getTime()) / DAY);
  const due = CHASER_DAYS.filter((d) => d <= days);
  const latest = due[due.length - 1];
  // Only the latest: a missed run never sends two pushes at once.
  return latest !== undefined && !sent.some((s) => s >= latest) ? latest : null;
}

/** Daily job (app/api/jobs/flush-sms). Idempotent: one push per chaser day. */
export async function chaseFinishSetup(now = new Date()): Promise<number> {
  const asks = await prisma.event.findMany({ where: { name: "finish_setup_asked" }, select: { ts: true, meta: true } });
  let sent = 0;
  for (const ask of asks) {
    const engineerId = (ask.meta as { engineerId?: string } | null)?.engineerId;
    if (!engineerId) continue;
    const e = await prisma.engineer.findUnique({
      where: { id: engineerId },
      select: { stripePayoutsEnabled: true, deletedAt: true, bannedAt: true },
    });
    if (!e || e.stripePayoutsEnabled || e.deletedAt || e.bannedAt) continue;
    const chased = await prisma.event.findMany({
      where: { name: "finish_setup_chased", meta: { path: ["engineerId"], equals: engineerId } },
      select: { meta: true },
    });
    const day = dueChaser(
      ask.ts,
      chased.map((c) => Number((c.meta as { day?: number } | null)?.day ?? 0)),
      now,
    );
    if (day === null) continue;
    await track("finish_setup_chased", { type: "SYSTEM" }, { engineerId, day });
    await sendPushNotification(engineerId, PUSH_TITLE, "Your customers' payments are waiting for you. It only takes a few minutes.", {
      url: "/get-paid",
    });
    sent += 1;
  }
  return sent;
}
