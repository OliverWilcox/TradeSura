import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { brandName } from "@/lib/engineer";
import { notifyEngineer } from "@/lib/sms";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-layout";
import { sendPushNotification } from "@/lib/push";

// Section 6 — Call and Message on the public profile. Every call tap and
// message is logged as an Enquiry so the app can say "TradeSura sent you N
// enquiries this month"; messages also reach the engineer by push and
// text/email.

export const ENQUIRY_SOURCES = ["profile", "town", "widget"] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

// ---------- spam guard (pure; tested in tests/enquiry-guard.test.ts) ----------

/** Messages one IP may send in an hour, across all engineers. */
export const MESSAGE_LIMIT_PER_HOUR = 5;
/** A person can't read the form and type a message faster than this. */
export const MIN_FILL_MS = 3000;
/** Repeat call taps from one IP to one engineer inside this window count once. */
export const CALL_DEDUPE_MINUTES = 30;

export type SpamVerdict = { ok: true } | { ok: false; reason: "honeypot" | "too_fast" | "rate_limited"; silent: boolean };

export function enquirySpamVerdict(opts: {
  honeypot: string | null | undefined;
  startedAt: number | null | undefined;
  now: number;
  recentFromIp: number;
}): SpamVerdict {
  // Bots get a fake success, so they don't learn what tripped them.
  if (opts.honeypot && opts.honeypot.trim() !== "") return { ok: false, reason: "honeypot", silent: true };
  if (opts.startedAt && opts.now - opts.startedAt < MIN_FILL_MS && opts.now >= opts.startedAt) {
    return { ok: false, reason: "too_fast", silent: true };
  }
  if (opts.recentFromIp >= MESSAGE_LIMIT_PER_HOUR) return { ok: false, reason: "rate_limited", silent: false };
  return { ok: true };
}

/** Name plus at least one way back, and a message worth reading. */
export function enquiryFieldsError(f: { name: string; phone: string; email: string; message: string }): string | null {
  if (f.name.trim().length < 2) return "Add your name.";
  if (!f.phone.trim() && !f.email.trim()) return "Add a phone number or email so they can reply.";
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Check your email address.";
  if (f.phone.trim() && f.phone.replace(/\D/g, "").length < 10) return "Check your phone number.";
  if (f.message.trim().length < 5) return "Tell them a little about what you need.";
  return null;
}

// We never store raw IPs — a salted hash is enough to rate-limit.
export function ipHash(ip: string): string {
  const salt = process.env.AUTH_SECRET ?? process.env.ADMIN_SECRET ?? "tradesura";
  return crypto.createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export async function recentAttempts(name: string, ip: string, minutes: number, engineerId?: string) {
  return prisma.event.count({
    where: {
      name,
      ts: { gte: new Date(Date.now() - minutes * 60_000) },
      AND: [
        { meta: { path: ["ip"], equals: ip } },
        ...(engineerId ? [{ meta: { path: ["engineerId"], equals: engineerId } }] : []),
      ],
    },
  });
}

export function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export async function enquiriesThisMonth(engineerId: string): Promise<number> {
  return prisma.enquiry.count({ where: { engineerId, createdAt: { gte: startOfMonth() } } });
}

// ---------- alert ----------

export async function alertEngineerOfMessage(enquiryId: string, emergency: string | null) {
  const q = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, include: { engineer: true } });
  const who = q.name?.trim() || "Someone";
  const snippet = (q.message ?? "").replace(/\s+/g, " ").slice(0, 120);
  await sendPushNotification(q.engineerId, `New enquiry from ${who}`, snippet, { url: "/enquiries" });
  const back = q.phone || q.email || "";
  await notifyEngineer(
    q.engineerId,
    `TradeSura: new enquiry from ${who}${back ? ` (${back})` : ""}: "${snippet}" Open the app to reply.`,
  ).catch((err) => console.error("[enquiry] engineer text failed:", err));
  const brand = brandName(q.engineer);
  await sendEmail({
    to: q.engineer.email,
    subject: `New enquiry from ${who} via your TradeSura profile`,
    replyTo: q.email,
    html: `<p>Hi ${escapeHtml(q.engineer.firstName ?? brand)},</p>
<p><b>${escapeHtml(who)}</b> sent you a message from your TradeSura profile:</p>
<blockquote>${escapeHtml(q.message ?? "")}</blockquote>
<p>${q.phone ? `Phone: <a href="tel:${escapeHtml(q.phone)}">${escapeHtml(q.phone)}</a><br>` : ""}${q.email ? `Email: <a href="mailto:${escapeHtml(q.email)}">${escapeHtml(q.email)}</a>` : ""}</p>
${emergency ? `<p><b>⚠ Emergency wording detected (${escapeHtml(emergency)}). They were shown the 0800 111 999 script and confirmed before sending.</b></p>` : ""}`,
  }).catch((err) => console.error("[enquiry] engineer email failed:", err));
  await track("enquiry_alert_sent", { type: "SYSTEM" }, { enquiryId, engineerId: q.engineerId });
}
