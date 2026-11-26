import { prisma } from "@/lib/db";
import { displayName } from "@/lib/engineer";
import { cardAlertEmail, type CardAlertPhoto, type CardAlertRead, type CardFrom } from "@/lib/card-alert-email";
import { emailConfigured, sendEmail } from "@/lib/email";
import { textStaff } from "@/lib/sms";
import { track } from "@/lib/track";
import { cardCheckView, currentReads } from "@/lib/admin/card-check";
import { afterResponse, cardPhoto, isNewCard, numbersOf, runCardCheck, withTimeout } from "@/lib/admin/verifications";
import { ukDay } from "@/lib/admin/time";

// 3.2: the instant alert to the team (Matt) when an engineer uploads their
// Gas Safe ID card, by email to VERIFICATION_ALERT_EMAIL and by text to
// VERIFICATION_ALERT_SMS (each may list several, comma-separated); either
// unset is skipped. The check page link needs ADMIN_APP_URL. Matt, 26 Nov:
// the email also carries both Gas Safe numbers, the automatic read and the
// card photos (inline, lib/card-alert-email.ts), so it waits for the read.
// The text stays to the business name and the link. Without Resend or Twilio
// keys (local, test) the dev drivers only print it. A failed alert never
// fails the upload.

/** Longest the alert waits for the automatic read before it goes saying the card's still being read. */
export const READ_WAIT_MS = 60_000;

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function cardAlertRecipients() {
  return { emails: list(process.env.VERIFICATION_ALERT_EMAIL), mobiles: list(process.env.VERIFICATION_ALERT_SMS) };
}

const ALERT_SELECT = {
  tradingName: true,
  legalName: true,
  slug: true,
  firstName: true,
  lastName: true,
  gasSafeNo: true,
  gasSafeRegistrationNo: true,
  gasSafeCardUrl: true,
  gasSafeCardBackUrl: true,
  gasSafeCardReadId: true,
  gasSafeVerifiedAt: true,
  gasSafeRegisterCheckedAt: true,
  owner: { select: { gasSafeNo: true, gasSafeRegistrationNo: true } },
} as const;

type AlertRow = NonNullable<Awaited<ReturnType<typeof alertRow>>>;
const alertRow = (engineerId: string) => prisma.engineer.findUnique({ where: { id: engineerId }, select: ALERT_SELECT });

/** The current card's read, judged as the Verification page judges it. */
async function readOf(engineerId: string, e: AlertRow, now: Date): Promise<CardAlertRead> {
  const own = (await currentReads([{ id: engineerId, gasSafeCardUrl: e.gasSafeCardUrl, gasSafeCardReadId: e.gasSafeCardReadId }])).get(engineerId);
  const read = own?.read ?? null;
  const passed = Boolean(e.gasSafeVerifiedAt && e.gasSafeCardReadId);
  const view = cardCheckView({
    hasCard: Boolean(e.gasSafeCardUrl),
    read,
    automaticRead: own?.automatic ?? null,
    live: Boolean(e.gasSafeVerifiedAt),
    passed,
    newCard: isNewCard(e, own?.passed ?? null),
    given: { ...numbersOf(e), firstName: e.firstName, lastName: e.lastName },
    today: ukDay(now),
    // Just uploaded: no read yet means it's still being read.
    uploadedAt: now,
    now,
  });
  const autoPassed = Boolean(read && read.source === "automatic" && passed && e.gasSafeCardReadId === read.id);
  const reasons = autoPassed
    ? [`It passed the card check automatically.${e.gasSafeRegisterCheckedAt ? "" : " The Gas Safe Register check is still to do."}`, ...view.reasons]
    : view.reasons;
  return { automatic: view.automatic, details: view.details, reasons, concerns: view.concerns, autoPassed };
}

const photo = (engineerId: string, side: "front" | "back"): Promise<CardAlertPhoto | null> =>
  cardPhoto(engineerId, side).catch((err) => {
    console.error(`[card-alert] the ${side} photo couldn't be read:`, err);
    return null;
  });

export async function alertCardUpload(engineerId: string, from: CardFrom) {
  const { emails, mobiles } = cardAlertRecipients();
  if (!emails.length && !mobiles.length) return;
  const e = await alertRow(engineerId);
  if (!e) return;
  const business = displayName(e);
  const admin = process.env.ADMIN_APP_URL?.replace(/\s+/g, "").replace(/\/$/, "");
  const link = admin ? `${admin}/verification/${engineerId}` : null;

  const sent = { email: 0, sms: 0 };
  if (emails.length) {
    const now = new Date();
    const [read, front, back] = await Promise.all([
      readOf(engineerId, e, now).catch((err) => {
        console.error("[card-alert] the card read couldn't be looked up:", err);
        return null;
      }),
      photo(engineerId, "front"),
      e.gasSafeCardBackUrl ? photo(engineerId, "back") : null,
    ]);
    const { licenceNo, registrationNo } = numbersOf(e);
    const email = cardAlertEmail({ business, licenceNo, registrationNo, from, at: now, link, read, photos: { front, back, backSent: Boolean(e.gasSafeCardBackUrl) } });
    for (const to of emails) {
      try {
        await sendEmail({ to, ...email });
        if (emailConfigured()) sent.email++;
      } catch (err) {
        console.error("[card-alert] email failed:", err);
      }
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

export function queueCardCheckAndAlert(engineerId: string, from: CardFrom, waitMs = READ_WAIT_MS): Promise<void> | void {
  return afterResponse(async () => {
    const check = runCardCheck(engineerId).then(
      () => {},
      (err) => console.error(`[card-check] ${engineerId} failed:`, err),
    );
    await withTimeout(check, waitMs).catch(() => {});
    await alertCardUpload(engineerId, from).catch((err) => console.error("[card-alert] failed:", err));
    // Keeps the invocation alive until a slow read has finished and been saved.
    await check;
  });
}
