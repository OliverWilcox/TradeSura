// Section 5 — ratings. One rating per logged service, plan holders only.
// Every rating is shown, never filtered (UK fake-review rules make filtering
// unlawful); the only way one comes down is removeRating() for clear abuse,
// with a logged reason.
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { brandName } from "@/lib/engineer";
import { track } from "@/lib/track";
import { notifyEngineer, sendSms } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { sendPushNotification } from "@/lib/push";
import { appUrl } from "@/lib/app-url";
import { checkEmergency } from "@/lib/compliance/interlock";
import { checkWording } from "@/lib/compliance/blocklist";

export const NEW_MEMBER_THRESHOLD_KEY = "rating_new_member_threshold";
const DEFAULT_NEW_MEMBER_THRESHOLD = 3;
export const COMMENT_MAX = 1000;
export const REPLY_MAX = 600;

// Admin-set numbers live in AppSetting (Section 10). A missing or garbled
// row falls back to the default rather than breaking a public page.
export async function settingInt(key: string, fallback: number): Promise<number> {
  const row = await prisma.appSetting.findUnique({ where: { key } }).catch(() => null);
  const n = row ? Number.parseInt(row.value, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---------- pure rules (tested in tests/ratings.test.ts) ----------

export function isValidStars(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 5;
}

/** 1 or 2 stars alerts the installer and TradeSura admin straight away. */
export function isLowRating(stars: number): boolean {
  return stars <= 2;
}

/** Plan holders only, after a logged service. */
export function canRequestRating(record: { kind: string; planId: string | null }): boolean {
  return record.kind === "service" && Boolean(record.planId);
}

/** "New to TradeSura" until the count reaches the admin threshold. */
export function isNewMember(count: number, threshold: number): boolean {
  return count < threshold;
}

/** One decimal place, e.g. 4.9; null with no ratings yet. */
export function averageStars(stars: number[]): number | null {
  if (stars.length === 0) return null;
  return Math.round((stars.reduce((a, b) => a + b, 0) / stars.length) * 10) / 10;
}

/** Shown publicly as first name + initial — "Sarah J." */
export function publicCustomerName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}

/** Why a reply can't be posted, or null if it can. One public reply per rating. */
export function replyError(rating: { reply: string | null; ratedAt: Date | null }, text: string): string | null {
  if (!rating.ratedAt) return "This customer hasn't rated yet.";
  if (rating.reply) return "You've already replied to this rating — one reply per rating.";
  const t = text.trim();
  if (t.length < 2) return "Write a reply first.";
  if (t.length > REPLY_MAX) return `Keep your reply under ${REPLY_MAX} characters.`;
  const wording = checkWording(t);
  if (!wording.ok) return `Replies can't say "${wording.phrase}". ${wording.explanation}`;
  return null;
}

// A rating counts publicly once it's been given and hasn't been removed.
const COUNTED = { ratedAt: { not: null }, removedAt: null, stars: { not: null } } as const;

// ---------- read helpers (used by profile + town pages) ----------

export async function ratingSummary(
  engineerId: string,
): Promise<{ average: number | null; count: number; isNew: boolean }> {
  const [agg, threshold] = await Promise.all([
    prisma.rating.aggregate({ where: { engineerId, ...COUNTED }, _avg: { stars: true }, _count: true }),
    settingInt(NEW_MEMBER_THRESHOLD_KEY, DEFAULT_NEW_MEMBER_THRESHOLD),
  ]);
  const count = agg._count;
  const avg = agg._avg.stars;
  return {
    average: avg == null ? null : Math.round(avg * 10) / 10,
    count,
    isNew: isNewMember(count, threshold),
  };
}

export type PublicRating = {
  id: string;
  stars: number;
  comment: string | null;
  customerName: string | null;
  ratedAt: Date;
  reply: string | null;
  repliedAt: Date | null;
};

/** Newest first. Every rating, never filtered by stars. Each is a "Verified TradeSura customer". */
export async function publicRatings(engineerId: string, limit = 20): Promise<PublicRating[]> {
  const rows = await prisma.rating.findMany({
    where: { engineerId, ...COUNTED },
    orderBy: { ratedAt: "desc" },
    take: limit,
    select: { id: true, stars: true, comment: true, customerName: true, ratedAt: true, reply: true, repliedAt: true },
  });
  return rows.map((r) => ({ ...r, stars: r.stars!, ratedAt: r.ratedAt! }));
}

// ---------- writes ----------

/**
 * After a logged service on a plan: make the Rating row and send the
 * customer a one-tap link, from the engineer. Idempotent per service record.
 */
export async function requestRating(serviceRecordId: string): Promise<{ requested: boolean }> {
  const record = await prisma.serviceRecord.findUnique({
    where: { id: serviceRecordId },
    include: { rating: true },
  });
  if (!record || record.rating || !canRequestRating(record)) return { requested: false };
  const plan = await prisma.plan.findUnique({
    where: { id: record.planId! },
    include: { customer: true, engineer: { select: { tradingName: true, legalName: true, slug: true, email: true } } },
  });
  if (!plan || (plan.status !== "ACTIVE" && plan.status !== "PAUSED")) return { requested: false };

  const rating = await prisma.rating
    .create({
      data: {
        engineerId: plan.engineerId,
        planId: plan.id,
        serviceRecordId: record.id,
        requestToken: crypto.randomBytes(16).toString("base64url"),
      },
    })
    .catch(() => null); // unique serviceRecordId — a double tap already made it
  if (!rating) return { requested: false };

  const brand = brandName(plan.engineer);
  const url = `${appUrl()}/rate/${rating.requestToken}`;
  await sendSms({
    engineerId: plan.engineerId,
    to: plan.customer.phone,
    body: `Hi ${plan.customer.firstName}, thanks for having ${brand} round for your service. How did it go? One tap to rate: ${url}`,
    messageClass: "TRANSACTIONAL",
    consentBasis: "plan-member-transactional",
  }).catch((err) => console.error("[ratings] request text failed:", err));
  if (plan.customer.email) {
    await sendEmail({
      to: plan.customer.email,
      subject: `How was your service with ${brand}?`,
      replyTo: plan.engineer.email,
      html: `<p>Hi ${escapeHtml(plan.customer.firstName)},</p>
<p>Thanks for having ${escapeHtml(brand)} round for your service. How did it go?</p>
<p><a href="${url}" style="display:inline-block;background:#0B1A2E;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold">Rate your service</a></p>
<p style="color:#5B6B82;font-size:13px">It takes one tap. Your rating shows on ${escapeHtml(brand)}'s public page as a verified TradeSura customer.</p>`,
    }).catch((err) => console.error("[ratings] request email failed:", err));
  }
  await track("rating_requested", { type: "ENGINEER", id: plan.engineerId }, { ratingId: rating.id, planId: plan.id });
  return { requested: true };
}

export type SubmitResult =
  | { ok: true; low: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string; emergency?: boolean };

/** The customer's one tap. Comment runs the gas-emergency interlock like every free-text input. */
export async function submitRating(
  token: string,
  input: { stars: unknown; comment?: string | null; acknowledged?: boolean },
): Promise<SubmitResult> {
  const rating = await prisma.rating.findUnique({
    where: { requestToken: token },
    include: { plan: { include: { customer: true } }, engineer: true },
  });
  if (!rating) return { ok: false, status: 404, error: "This rating link isn't valid." };
  if (rating.ratedAt) return { ok: false, status: 409, error: "You've already rated this service — thank you." };
  if (!isValidStars(input.stars)) return { ok: false, status: 400, error: "Tap 1 to 5 stars." };
  const comment = input.comment?.trim().slice(0, COMMENT_MAX) || null;

  if (comment) {
    const check = checkEmergency(comment);
    if (check.emergency && !input.acknowledged) {
      await track("emergency_interlock_triggered", { type: "CUSTOMER", id: rating.plan.customerId }, {
        planId: rating.planId,
        matched: check.matched,
        surface: "rating",
      });
      await sendPushNotification(
        rating.engineerId,
        "Gas safety alert",
        `${rating.plan.customer.firstName} ${rating.plan.customer.lastName} mentioned a possible gas emergency and was told to call 0800 111 999.`,
        { url: `/customer/${rating.plan.customerId}` },
      );
      return { ok: false, status: 409, error: "emergency", emergency: true };
    }
  }

  const stars = input.stars;
  const customerName = publicCustomerName(rating.plan.customer.firstName, rating.plan.customer.lastName);
  // Conditional update so two taps can't both land.
  const updated = await prisma.rating.updateMany({
    where: { id: rating.id, ratedAt: null },
    data: { stars, comment, customerName, ratedAt: new Date() },
  });
  if (updated.count === 0) return { ok: false, status: 409, error: "You've already rated this service — thank you." };

  await track("rating_given", { type: "CUSTOMER", id: rating.plan.customerId }, {
    ratingId: rating.id,
    engineerId: rating.engineerId,
    stars,
  });

  const low = isLowRating(stars);
  if (low) await alertLowRating(rating.id);
  else {
    await sendPushNotification(rating.engineerId, "New rating", `${customerName} gave you ${stars} stars.`, {
      url: "/ratings",
    });
  }
  return { ok: true, low };
}

async function alertLowRating(ratingId: string) {
  const r = await prisma.rating.findUniqueOrThrow({
    where: { id: ratingId },
    include: { plan: { include: { customer: true } }, engineer: true },
  });
  const who = `${r.plan.customer.firstName} ${r.plan.customer.lastName}`;
  const line = `${who} rated their service ${r.stars} star${r.stars === 1 ? "" : "s"}${r.comment ? `: "${r.comment.slice(0, 120)}"` : "."}`;
  await sendPushNotification(r.engineerId, "Low rating", `${line} A quick call often helps.`, { url: "/ratings" });
  await notifyEngineer(r.engineerId, `TradeSura: ${line} You can reply publicly from Ratings in the app.`).catch(
    (err) => console.error("[ratings] engineer text failed:", err),
  );
  const admin = process.env.ADMIN_EMAIL?.trim() || "info@tradesura.com";
  await sendEmail({
    to: admin,
    subject: `Low rating (${r.stars}★) — ${brandName(r.engineer)}`,
    html: `<p><b>${escapeHtml(brandName(r.engineer))}</b> (engineer ${escapeHtml(r.engineerId)}) received a ${r.stars}-star rating from ${escapeHtml(who)} on plan ${escapeHtml(r.plan.ref)}.</p>
${r.comment ? `<blockquote>${escapeHtml(r.comment)}</blockquote>` : "<p>No comment left.</p>"}
<p>Rating id: ${escapeHtml(r.id)}</p>`,
  }).catch((err) => console.error("[ratings] admin email failed:", err));
  await track("rating_low_alert", { type: "SYSTEM" }, { ratingId: r.id, engineerId: r.engineerId, stars: r.stars });
}

/** One public reply per rating, by the installer it's about. */
export async function replyToRating(
  engineerId: string,
  ratingId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; status: 400 | 404 | 409; error: string }> {
  const rating = await prisma.rating.findFirst({ where: { id: ratingId, engineerId, removedAt: null } });
  if (!rating) return { ok: false, status: 404, error: "Rating not found." };
  const err = replyError(rating, text);
  if (err) return { ok: false, status: rating.reply ? 409 : 400, error: err };
  const updated = await prisma.rating.updateMany({
    where: { id: ratingId, reply: null },
    data: { reply: text.trim(), repliedAt: new Date() },
  });
  if (updated.count === 0) return { ok: false, status: 409, error: "You've already replied to this rating." };
  await track("rating_replied", { type: "ENGINEER", id: engineerId }, { ratingId });
  return { ok: true };
}

/** Admin only: removal for clear abuse, with the reason logged. Never for a low score. */
export async function removeRating(
  id: string,
  reason: string,
  /** Who removed it (admin email or id), kept in the event log. */
  removedBy?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const why = reason.trim();
  if (why.length < 5) return { ok: false, error: "Give the reason this rating is being removed." };
  const rating = await prisma.rating.findUnique({ where: { id } });
  if (!rating) return { ok: false, error: "Rating not found." };
  if (rating.removedAt) return { ok: false, error: "This rating was already removed." };
  await prisma.rating.update({ where: { id }, data: { removedAt: new Date(), removedReason: why } });
  await track("rating_removed", { type: "SYSTEM" }, {
    removedBy,
    ratingId: id,
    engineerId: rating.engineerId,
    stars: rating.stars,
    reason: why,
  });
  return { ok: true };
}
