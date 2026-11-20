import { prisma } from "@/lib/db";
import { track } from "@/lib/track";
import { sendEmail } from "@/lib/email";
import { emailButton, emailShell, escapeHtml, EMAIL } from "@/lib/email-layout";

// Matt, 12 Nov — a Trustpilot review invite to every customer after their
// first service is marked done, and to every engineer after their first
// Friday payout. Everyone, never picked by how happy they are (Trustpilot's
// rule), once each. Off until TRUSTPILOT_REVIEW_URL is set. With
// TRUSTPILOT_INVITE_BCC (the "automatic feedback" address Trustpilot gives
// the account) each invite email is copied to Trustpilot, so the review
// counts as invited. TRUSTPILOT_MONTHLY_LIMIT (default 50, the free plan)
// caps invites per calendar month; anyone over it is simply not invited.

const EVENT = "trustpilot_invited";

function reviewUrl(): string | null {
  return process.env.TRUSTPILOT_REVIEW_URL?.trim() || null;
}

function monthlyLimit(): number {
  const raw = process.env.TRUSTPILOT_MONTHLY_LIMIT?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

async function underMonthlyLimit(now: Date): Promise<boolean> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sent = await prisma.event.count({ where: { name: EVENT, ts: { gte: start } } });
  return sent < monthlyLimit();
}

async function alreadyInvited(kind: "customer" | "engineer", id: string): Promise<boolean> {
  const seen = await prisma.event.findFirst({
    where: { name: EVENT, AND: [{ meta: { path: ["kind"], equals: kind } }, { meta: { path: ["id"], equals: id } }] },
    select: { id: true },
  });
  return Boolean(seen);
}

function inviteHtml(firstName: string | null, intro: string, url: string) {
  const rows = `<tr><td style="padding:24px 32px 0;font-size:15px;line-height:23px;color:${EMAIL.body};">
<p style="margin:0 0 12px;">Hi ${escapeHtml(firstName || "there")},</p>
<p style="margin:0 0 12px;">${intro}</p>
<p style="margin:0 0 20px;">Would you leave a quick review of TradeSura on Trustpilot? It takes a minute and helps other people find us.</p>
</td></tr><tr><td style="padding:0 32px 28px;">${emailButton(url, "Review us on Trustpilot")}</td></tr>`;
  return emailShell({ title: "How are we doing?", preheader: "A quick review helps other people find TradeSura.", rows });
}

async function invite(kind: "customer" | "engineer", id: string, to: string, firstName: string | null, intro: string): Promise<boolean> {
  const url = reviewUrl();
  if (!url) return false;
  const now = new Date();
  if (await alreadyInvited(kind, id)) return false;
  if (!(await underMonthlyLimit(now))) {
    await track("trustpilot_invite_skipped", { type: "SYSTEM" }, { kind, id, reason: "monthly_limit" });
    return false;
  }
  await track(EVENT, { type: "SYSTEM" }, { kind, id });
  await sendEmail({
    to,
    subject: "How are we doing?",
    html: inviteHtml(firstName, intro, url),
    bcc: process.env.TRUSTPILOT_INVITE_BCC?.trim() || null,
  }).catch((err) => console.error("[trustpilot] invite failed:", err));
  return true;
}

/** After a customer's first service is marked done (the first service record logged for them). */
export async function inviteCustomerAfterFirstService(customerId: string, engineerId: string): Promise<boolean> {
  try {
    if (!reviewUrl()) return false;
    const plans = await prisma.plan.findMany({ where: { customerId, engineerId }, select: { id: true } });
    if (!plans.length) return false;
    const services = await prisma.serviceRecord.count({ where: { kind: "service", planId: { in: plans.map((p) => p.id) } } });
    if (services !== 1) return false;
    const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true, firstName: true } });
    if (!c?.email) return false;
    return await invite("customer", customerId, c.email, c.firstName, "Your first service on your care plan is done.");
  } catch (err) {
    console.error("[trustpilot] customer invite failed:", err);
    return false;
  }
}

/** After an engineer's first Friday payout. */
export async function inviteEngineerAfterFirstPayout(engineerId: string): Promise<boolean> {
  try {
    if (!reviewUrl()) return false;
    const e = await prisma.engineer.findUnique({ where: { id: engineerId }, select: { email: true, firstName: true } });
    if (!e?.email) return false;
    return await invite("engineer", engineerId, e.email, e.firstName, "Your first payout from TradeSura is on its way to your bank.");
  } catch (err) {
    console.error("[trustpilot] engineer invite failed:", err);
    return false;
  }
}
