import { prisma } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/email-layout";
import { accountEmail } from "@/lib/account-emails";
import { track } from "@/lib/track";

export const TRUSTPILOT_INVITE_DAYS = 3;
export const TRUSTPILOT_EVENT = "trustpilot_invite_sent";
const DAY_MS = 24 * 60 * 60 * 1000;

export function trustpilotUrl(): string | null {
  return process.env.TRUSTPILOT_REVIEW_URL?.trim() || null;
}

export function trustpilotInviteEmail(firstName: string | null, url: string) {
  return accountEmail({
    firstName,
    title: "How are you finding TradeSura?",
    preheader: "A quick review helps other installers find us.",
    paragraphs: [
      "You've been live on TradeSura for a few days now. If it's working for you, a short review on Trustpilot helps other installers decide to join, and it takes about a minute.",
      "If something isn't right, reply to this email instead and we'll put it right first.",
    ],
    button: { href: url, label: "Review us on Trustpilot" },
  });
}

export async function sendTrustpilotInvites(now = new Date()): Promise<number> {
  const url = trustpilotUrl();
  if (!url) return 0;
  const due = await prisma.engineer.findMany({
    where: { ownerId: null, deletedAt: null, bannedAt: null, pausedAt: null, leftAt: null, gasSafeVerifiedAt: { lte: new Date(now.getTime() - TRUSTPILOT_INVITE_DAYS * DAY_MS) } },
    select: { id: true, email: true, firstName: true },
  });
  const invited = new Set(
    (await prisma.event.findMany({ where: { name: TRUSTPILOT_EVENT }, select: { meta: true } })).map((ev) => (ev.meta as { engineerId?: string }).engineerId),
  );
  let sent = 0;
  for (const e of due) {
    if (invited.has(e.id) || !e.email) continue;
    await track(TRUSTPILOT_EVENT, { type: "SYSTEM" }, { engineerId: e.id, days: TRUSTPILOT_INVITE_DAYS });
    const mail = trustpilotInviteEmail(e.firstName, url);
    await sendEmail({ to: e.email, subject: mail.subject, html: mail.html, replyTo: SUPPORT_EMAIL }).catch((err) => console.error("[trustpilot] invite failed:", err));
    sent += 1;
  }
  return sent;
}

export async function trustpilotInviteOf(engineerId: string, verifiedAt: Date | null) {
  const ev = await prisma.event.findFirst({ where: { name: TRUSTPILOT_EVENT, meta: { path: ["engineerId"], equals: engineerId } }, select: { ts: true } });
  return {
    configured: Boolean(trustpilotUrl()),
    sentAt: ev?.ts.toISOString() ?? null,
    dueOn: ev || !verifiedAt ? null : new Date(verifiedAt.getTime() + TRUSTPILOT_INVITE_DAYS * DAY_MS).toISOString(),
  };
}
