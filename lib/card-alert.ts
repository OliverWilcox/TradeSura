import { after } from "next/server";
import { prisma } from "@/lib/db";
import { displayName } from "@/lib/engineer";
import { cardAlertEmail, type CardFrom } from "@/lib/card-alert-email";
import { emailConfigured, sendEmail } from "@/lib/email";
import { textStaff } from "@/lib/sms";
import { track } from "@/lib/track";

// 3.2: the instant alert to the team (Matt) when an engineer uploads their
// Gas Safe ID card, at sign-up or later in Settings, so it's checked against
// the Gas Safe Register the same day (Matt, 4 Nov). By email to
// VERIFICATION_ALERT_EMAIL and by text to VERIFICATION_ALERT_SMS (each may
// list several, comma-separated); either unset is skipped. The check page
// link needs ADMIN_APP_URL. Nothing about the engineer beyond their business
// and Gas Safe number goes in it. Without Resend or Twilio keys (local, test)
// the dev drivers only print it. A failed alert never fails the upload.

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function cardAlertRecipients() {
  return { emails: list(process.env.VERIFICATION_ALERT_EMAIL), mobiles: list(process.env.VERIFICATION_ALERT_SMS) };
}

export async function alertCardUpload(engineerId: string, from: CardFrom) {
  const { emails, mobiles } = cardAlertRecipients();
  if (!emails.length && !mobiles.length) return;
  const e = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { tradingName: true, legalName: true, slug: true, gasSafeNo: true } });
  if (!e) return;
  const business = displayName(e);
  const admin = process.env.ADMIN_APP_URL?.replace(/\s+/g, "").replace(/\/$/, "");
  const link = admin ? `${admin}/verification/${engineerId}` : null;
  const email = cardAlertEmail({ business, gasSafeNo: e.gasSafeNo, from, at: new Date(), link });

  const sent = { email: 0, sms: 0 };
  for (const to of emails) {
    try {
      await sendEmail({ to, ...email });
      if (emailConfigured()) sent.email++;
    } catch (err) {
      console.error("[card-alert] email failed:", err);
    }
  }
  for (const to of mobiles) {
    try {
      if (await textStaff(to, `TradeSura: Gas Safe card to check from ${business}.${link ? ` ${link}` : ""}`)) sent.sms++;
    } catch (err) {
      console.error("[card-alert] text failed:", err);
    }
  }
  await track("verification_alert_sent", { type: "SYSTEM" }, { engineerId, from, emails: sent.email, texts: sent.sms }).catch(() => {});
}

/** Sends the alert once the upload has been answered (Next's after()), or straight away outside a request (scripts, tests). */
export function queueCardAlert(engineerId: string, from: CardFrom): Promise<void> | void {
  const task = () => alertCardUpload(engineerId, from).catch((err) => console.error("[card-alert] failed:", err));
  try {
    after(task);
  } catch {
    return task();
  }
}
