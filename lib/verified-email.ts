// Matt, 30 Oct §11 — the "You're verified" email v2 (preview on the last
// page of TradeSura_Update_Oliver_30Oct.pdf; the HTML file itself wasn't
// supplied, so this follows the preview, on the same shell as the
// first-customer email). It goes out the moment the Gas Safe check passes,
// in two Founding versions (top spot / badge only) or none.
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { sendEmail } from "@/lib/email";
import { EMAIL, SUPPORT_EMAIL, emailAssetBase, emailButton, emailShell, escapeHtml } from "@/lib/email-layout";
import { brandName } from "@/lib/engineer";
import { canonicalProfileDisplay, canonicalProfileUrl } from "@/lib/public-url";
import { REFERRAL_FIRST_YEAR_PERCENT, REFERRAL_LIFETIME_PERCENT } from "@/lib/referral";
import { track } from "@/lib/track";

export const SUPPORT_PHONE = "0330 223 8456";
const SUPPORT_TEL = "+443302238456";
const EXAMPLE_CUSTOMERS = 20;

export type Founding = { kind: "top"; town: string; keepDays: number } | { kind: "badge"; town: string | null } | null;

export type VerifiedEmailInput = {
  firstName: string | null;
  slug: string;
  /** Their first live plan, for the "20 customers on your £15 plan" box. */
  plan: { name: string; priceMonthlyPence: number } | null;
  founding: Founding;
  /** INSTALLER_WHATSAPP_GROUP_URL; the line is hidden without it. */
  groupUrl: string | null;
};

const pounds = (pence: number) => `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 2, minimumFractionDigits: pence % 100 ? 2 : 0 })}`;

// The engineer's 80% (our fee is 20% rounded down), a year, for N customers.
export function yearlyForCustomers(priceMonthlyPence: number, customers = EXAMPLE_CUSTOMERS): number {
  return (priceMonthlyPence - Math.floor(priceMonthlyPence * 0.2)) * 12 * customers;
}

export function verifiedEmail(v: VerifiedEmailInput): { subject: string; html: string } {
  const open = (to: string) => `${appUrl()}/api/open?to=${to}`;
  const link = (href: string, label: string) => `<a href="${href}" style="color:${EMAIL.link};font-weight:700;">${label}</a>`;
  const name = v.firstName?.trim();
  const title = name ? `You're verified, ${name}!` : "You're verified!";
  const p = (html: string, extra = "") =>
    `<p style="margin:0;font-size:15px;line-height:22px;color:${EMAIL.body};${extra}">${html}</p>`;

  const founding =
    v.founding?.kind === "top"
      ? `<b>FOUNDING MEMBER · ${escapeHtml(v.founding.town.toUpperCase())}</b><br>You're one of the <b>first 3 in ${escapeHtml(v.founding.town)}</b>, so your business sits at the <b>top of the ${escapeHtml(v.founding.town)} page</b>, where homeowners look first. Sign your first customer within <b>${v.founding.keepDays} days</b> to keep your top spot.`
      : v.founding?.kind === "badge"
        ? `<b>FOUNDING MEMBER${v.founding.town ? ` · ${escapeHtml(v.founding.town.toUpperCase())}` : ""}</b><br>You claimed your account in time, so your <b>Founding Member badge</b> shows on your page, your plans and the town page for good.`
        : "";

  const sell = v.plan
    ? `<tr><td style="padding:4px 32px 6px;"><div style="background:#E8F6EF;border-radius:12px;padding:16px 18px;">
        <div style="font-size:13px;color:${EMAIL.body};">${EXAMPLE_CUSTOMERS} customers on your ${escapeHtml(pounds(v.plan.priceMonthlyPence))} plan</div>
        <div style="font-size:26px;line-height:32px;font-weight:700;color:${EMAIL.money};">${escapeHtml(pounds(yearlyForCustomers(v.plan.priceMonthlyPence)))} a year to you</div>
        <div style="font-size:13px;color:${EMAIL.body};">Paid straight to your bank, every Friday.</div>
      </div></td></tr>`
    : "";

  const item = (html: string) =>
    `<tr><td style="padding:0 32px;"><div style="border-top:1px solid ${EMAIL.line};padding:12px 0;font-size:14px;line-height:21px;color:${EMAIL.body};">${html}</div></td></tr>`;
  const small = (html: string) => `<tr><td style="padding:6px 32px 0;font-size:13.5px;line-height:20px;color:${EMAIL.body};">${html}</td></tr>`;

  const rows = `
  <tr><td align="center" style="padding:28px 32px 4px;">
    <img src="${emailAssetBase()}/brand/verified-member-badge.png" width="96" height="96" alt="TradeSura Verified Member" style="display:block;border:0;">
    <div style="margin-top:14px;font-size:11px;letter-spacing:1.4px;font-weight:700;color:${EMAIL.money};">GAS SAFE CHECK PASSED</div>
    <div style="margin-top:6px;font-size:24px;line-height:30px;font-weight:700;color:${EMAIL.ink};">${escapeHtml(title)}</div>
    ${p("Your <b>Verified Member</b> badge is now live on your page and on every plan you send. Homeowners can see it from today.", "margin-top:10px;")}
  </td></tr>
  ${founding ? `<tr><td style="padding:18px 32px 4px;"><div style="background:${EMAIL.navy};border-radius:12px;padding:16px 18px;font-size:14px;line-height:21px;color:#ffffff;">${founding.replace("<b>FOUNDING", '<b style="font-size:11px;letter-spacing:1.2px;color:#3DD68C;">FOUNDING')}</div></td></tr>` : ""}
  <tr><td align="center" style="padding:20px 32px 10px;">${p("The fastest way to your first customer: <b>you're already sat on them.</b>")}</td></tr>
  <tr><td style="padding:0 32px 4px;">${emailButton(open("customers"), "Send your plans to your last 10 customers", { color: EMAIL.money })}</td></tr>
  <tr><td align="center" style="padding:0 32px 14px;font-size:12px;color:${EMAIL.muted};">Takes about a minute. We send them for you.</td></tr>
  ${sell}
  <tr><td style="padding:18px 32px 4px;font-size:11px;letter-spacing:1.2px;font-weight:700;color:${EMAIL.muted};">TWO MORE WAYS TO WIN CUSTOMERS</td></tr>
  ${item(`<b>Offer a plan at your next job.</b> No selling needed: pick why you were there, hand them your phone, and the app does the selling. ${link(open("offer"), "Open the app")}`)}
  ${item(`<b>Share your page</b> on Facebook, WhatsApp or your invoices: ${link(canonicalProfileUrl({ slug: v.slug }), escapeHtml(canonicalProfileDisplay({ slug: v.slug })))}`)}
  ${small(`📦 <b>Your member pack</b> is being posted this week.`)}
  ${small(`🤝 <b>Know another engineer?</b> Share your code <b>${escapeHtml(v.slug)}</b>. You earn ${REFERRAL_FIRST_YEAR_PERCENT}% of our fee on every plan they sell for 12 months, then ${REFERRAL_LIFETIME_PERCENT}% for life.`)}
  ${v.groupUrl ? small(`💬 <b>Join the TradeSura installer group</b> on WhatsApp: share tips, ask questions and swap work with other installers. ${link(escapeHtml(v.groupUrl), "Join the group")}`) : ""}
  <tr><td style="padding:18px 32px 26px;"><div style="background:${EMAIL.wash};border-radius:12px;padding:14px 16px;font-size:13.5px;line-height:20px;color:${EMAIL.body};">
    <b>Need a hand?</b> Call or WhatsApp us on <a href="tel:${SUPPORT_TEL}" style="color:${EMAIL.link};">${SUPPORT_PHONE}</a>, or just reply to this email. We reply within 2 hours in working hours.
  </div></td></tr>`;

  const footerExtra = `You're getting this because you have a TradeSura engineer account. <a href="${appUrl()}/privacy" style="color:${EMAIL.muted};">Privacy policy</a><br>`;
  return { subject: title, html: emailShell({ title, preheader: "Your Verified Member badge is live from today.", rows, footerExtra }) };
}

/**
 * Founding version from what's known today: a redeemed launch-letter claim
 * code = Founding badge. The top-spot version needs the town's top 3 (the
 * Founding work) — pass `founding` in once that's decided.
 */
async function defaultFounding(engineerId: string, town: string | null): Promise<Founding> {
  const code = await prisma.claimCode.findFirst({
    where: { redeemedByEngineerId: engineerId, suppressedAt: null },
    select: { code: true },
  });
  return code ? { kind: "badge", town } : null;
}

/** Sends once per engineer (an event is recorded first), the moment Gas Safe is verified. */
export async function sendVerifiedEmail(engineerId: string, opts: { founding?: Founding } = {}): Promise<boolean> {
  const e = await prisma.engineer.findUnique({
    where: { id: engineerId },
    select: { id: true, email: true, firstName: true, slug: true, town: true, tradingName: true, legalName: true, gasSafeVerifiedAt: true, ownerId: true },
  });
  if (!e?.email || !e.gasSafeVerifiedAt || e.ownerId) return false;
  const sent = await prisma.event.findFirst({
    where: { name: "verified_email_sent", meta: { path: ["engineerId"], equals: engineerId } },
    select: { id: true },
  });
  if (sent) return false;
  await track("verified_email_sent", { type: "SYSTEM" }, { engineerId });

  const tier = await prisma.planTier.findFirst({
    where: { engineerId, status: "LIVE" },
    orderBy: { sortOrder: "asc" },
    select: { name: true, priceMonthlyPence: true },
  });
  const email = verifiedEmail({
    firstName: e.firstName,
    slug: e.slug,
    plan: tier && tier.priceMonthlyPence > 0 ? tier : null,
    founding: opts.founding !== undefined ? opts.founding : await defaultFounding(engineerId, e.town),
    groupUrl: process.env.INSTALLER_WHATSAPP_GROUP_URL?.trim() || null,
  });
  try {
    await sendEmail({ to: e.email, subject: email.subject, html: email.html, replyTo: SUPPORT_EMAIL });
    return true;
  } catch (err) {
    console.error(`[verified-email] ${brandName(e)} failed:`, err);
    return false;
  }
}

/**
 * Daily safety net (app/api/jobs/flush-sms): anyone verified in the last 3
 * days who hasn't had it — e.g. verified from a screen that doesn't call
 * sendVerifiedEmail yet. Older accounts never get it on deploy.
 */
export async function sendMissedVerifiedEmails(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const recent = await prisma.engineer.findMany({
    where: { gasSafeVerifiedAt: { gte: since }, ownerId: null, deletedAt: null, bannedAt: null },
    select: { id: true },
  });
  let sent = 0;
  for (const r of recent) if (await sendVerifiedEmail(r.id)) sent += 1;
  return sent;
}
