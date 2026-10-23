// Engineer signup welcome email — 2026 Build Guide mock-up (15 Oct), which
// wins over older rules (CLAUDE.md). The checklist ticks off from the
// account's real setup state.
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/app-url";
import { EMAIL, SUPPORT_EMAIL, emailAssetBase, emailButton, emailShell, escapeHtml } from "@/lib/email-layout";
import { REFERRAL_FIRST_YEAR_PERCENT, REFERRAL_LIFETIME_PERCENT } from "@/lib/referral";
import { computeApplicationFeePence } from "@/lib/stripe";

// Build Review 3, P1 — earnings use the engineer's 80% (after TradeSura's
// fee, rounded down in their favour), never the customer's price: a £12
// plan is £115 a year to the engineer, not £144.
const EXAMPLE_PLAN_PENCE = 1200;
const EXAMPLE_CUSTOMERS = 10;
export function engineerYearlyPence(planPence: number): number {
  return (planPence - computeApplicationFeePence(planPence)) * 12;
}
function wholePounds(pence: number): string {
  return `£${Math.floor(pence / 100).toLocaleString("en-GB")}`;
}

type Item = { done: boolean; title: string; hint: string };

function checklistRow(item: Item, last: boolean): string {
  const border = last ? "" : `border-bottom:1px solid ${EMAIL.line};`;
  const mark = item.done
    ? `<div style="width:22px;height:22px;border-radius:11px;background:#3DD68C;color:${EMAIL.navy};font-weight:700;text-align:center;line-height:22px;font-size:13px;">&#10003;</div>`
    : `<div style="width:18px;height:18px;border-radius:11px;border:2px solid ${EMAIL.blue};"></div>`;
  const label = item.done
    ? `<span style="color:${EMAIL.muted};"><s>${item.title}</s></span>`
    : `<b>${item.title}</b> <span style="color:${EMAIL.muted};">· ${item.hint}</span>`;
  return `<tr><td width="34" valign="top" style="padding:9px 0;">${mark}</td>
          <td style="padding:9px 0;${border}">${label}</td></tr>`;
}

export async function engineerWelcomeEmailHtml(engineerId: string) {
  const e = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const [liveTiers, customerCount, referralCount] = await Promise.all([
    prisma.planTier.count({ where: { engineerId, status: "LIVE" } }),
    prisma.customer.count({ where: { engineerId } }),
    prisma.engineer.count({ where: { referrerId: engineerId } }),
  ]);
  const firstName = escapeHtml(e.firstName || "there");
  // Build Review 3, P1 — the BUSINESS name fills in ("MW Heating now has a
  // free TradeSura account"): trading name, else the Companies House name.
  const brand = escapeHtml(
    e.tradingName?.trim() || e.legalName?.trim() || "Your business",
  );
  const perCustomer = engineerYearlyPence(EXAMPLE_PLAN_PENCE);
  const examplePounds = `£${EXAMPLE_PLAN_PENCE / 100}`;
  const base = appUrl();
  const open = (to: string) => `${base}/api/open?to=${to}`;
  // The mock-up's "WhatsApp us on …" line — set SUPPORT_WHATSAPP to show it.
  const whatsapp = process.env.SUPPORT_WHATSAPP?.trim();

  // The app's seven setup steps, in the Getting started hub's order
  // (mobile/lib/setup-steps.ts), so the email and the app count the same.
  const items: Item[] = [
    { done: liveTiers > 0, title: "Build your first plan", hint: `start from Boiler Care at ${examplePounds}` },
    { done: e.stripeChargesEnabled, title: "Get paid", hint: "about 3 minutes with Stripe" },
    { done: Boolean(e.profilePublishedAt), title: "Get found on Google", hint: "your free profile page" },
    { done: Boolean(e.websiteConnectedAt), title: "Connect your website", hint: "sell plans there too" },
    { done: customerCount > 0, title: "Bring in your customers", hint: `each one worth up to ${wholePounds(perCustomer)} a year to you` },
    { done: Boolean(e.inviteSharedAt) || referralCount > 0, title: "Invite engineers you know", hint: `earn ${REFERRAL_FIRST_YEAR_PERCENT}% of our fee on their plans` },
    { done: Boolean(e.packRequestedAt), title: "Member pack", hint: "posts once your Gas Safe check is done" },
  ];
  const doneCount = items.filter((i) => i.done).length;

  const rows = `
  <tr><td bgcolor="${EMAIL.navy}" style="background:${EMAIL.navy};padding:4px 32px 30px;">
    <div style="font-size:28px;line-height:34px;font-weight:700;color:#ffffff;">You're in, ${firstName} &#128075;</div>
    <div style="font-size:16px;line-height:24px;color:#C5D0E0;padding-top:10px;"><b style="color:#ffffff;">${brand}</b> now has a free TradeSura account. Sell your own care plans at the end of every job. Customers pay monthly by Direct Debit, you keep <b style="color:#3DD68C;">80%</b>, paid every Friday.</div>
  </td></tr>

  <tr><td style="padding:24px 32px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F2FBF6;border:1px solid #BDEBD3;border-radius:12px;">
      <tr><td style="padding:16px 18px;font-size:15px;line-height:22px;color:${EMAIL.ink};">
        Just <b>${EXAMPLE_CUSTOMERS} customers</b> on a ${examplePounds} plan =<br>
        <span style="font-size:26px;line-height:34px;font-weight:700;color:${EMAIL.money};">${wholePounds(perCustomer * EXAMPLE_CUSTOMERS)} a year</span> <span style="color:${EMAIL.muted};">in your pocket</span>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 32px 4px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:${EMAIL.blue};text-transform:uppercase;">Your setup · ${doneCount} of ${items.length} done</div>
    <div style="font-size:13px;color:${EMAIL.muted};padding:4px 0 10px;">About 8 minutes in total. Pick up where you left off any time.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:21px;color:${EMAIL.ink};">
      ${items.map((it, i) => checklistRow(it, i === items.length - 1)).join("")}
    </table>
  </td></tr>

  <tr><td align="center" style="padding:22px 32px 8px;">
    ${emailButton(open("onboarding"), "Open TradeSura and finish setup")}
  </td></tr>

  <tr><td style="padding:22px 32px 4px;">
    <div style="font-size:13px;font-weight:700;letter-spacing:1px;color:${EMAIL.blue};text-transform:uppercase;padding-bottom:8px;">What happens next</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:20px;color:${EMAIL.ink};">
      <tr><td width="28" valign="top" style="color:${EMAIL.link};font-weight:700;padding:5px 0;">1</td><td style="padding:5px 0;">We check your Gas Safe registration, usually within 24 hours.</td></tr>
      <tr><td width="28" valign="top" style="color:${EMAIL.link};font-weight:700;padding:5px 0;">2</td><td style="padding:5px 0;">Your <b>Verified Member</b> badge goes live on your plans and profile.</td></tr>
      <tr><td width="28" valign="top" style="color:${EMAIL.link};font-weight:700;padding:5px 0;">3</td><td style="padding:5px 0;">Your member pack is posted, with QR boiler stickers that link each boiler to its Home Passport.</td></tr>
    </table>
  </td></tr>

  <tr><td style="padding:22px 32px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td width="50%" valign="top" style="padding-right:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.wash};border-radius:12px;"><tr><td style="padding:16px;font-size:14px;line-height:20px;color:${EMAIL.ink};">
            <div style="font-weight:700;font-size:15px;padding-bottom:4px;">Give customers a choice</div>
            Offer 2 or 3 plans, e.g. service and priority from £10, Boiler Care, and a Landlord plan with the CP12. Customers like picking.
            <div style="padding-top:8px;"><a href="${open("plan-wizard")}" style="color:${EMAIL.link};font-weight:700;text-decoration:none;">Build a plan &rarr;</a></div>
          </td></tr></table>
        </td>
        <td width="50%" valign="top" style="padding-left:8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${EMAIL.wash};border-radius:12px;"><tr><td style="padding:16px;font-size:14px;line-height:20px;color:${EMAIL.ink};">
            <div style="font-weight:700;font-size:15px;padding-bottom:4px;">Know another engineer?</div>
            Earn <b>${REFERRAL_FIRST_YEAR_PERCENT}% of our fee</b> on every plan they sell for their first year, then <b>${REFERRAL_LIFETIME_PERCENT}% for life</b>.
            <div style="padding-top:8px;"><a href="${base}/join/${escapeHtml(e.slug)}" style="color:${EMAIL.link};font-weight:700;text-decoration:none;">Share your invite link &rarr;</a></div>
          </td></tr></table>
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:16px 32px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #DCE3EC;border-radius:12px;"><tr><td style="padding:16px;font-size:14px;line-height:20px;color:${EMAIL.ink};">
      <div style="font-weight:700;font-size:15px;padding-bottom:4px;">Your customers come with the house</div>
      Every plan builds a <b>Home Passport</b>: a full service history that stays with the home. When it sells, the new owner finds your name on the boiler and your work on record, ready to carry on.
    </td></tr></table>
  </td></tr>

  <tr><td style="padding:22px 32px 26px;font-size:14px;line-height:21px;color:${EMAIL.body};">
    Any questions, just reply to this email${whatsapp ? ` or WhatsApp us on ${escapeHtml(whatsapp)}` : ` or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMAIL.link};">${SUPPORT_EMAIL}</a>`}. We're here to help you get your first plan live.<br><br>
    The TradeSura team
  </td></tr>`;

  const footerExtra = `<img src="${emailAssetBase()}/brand/stripe/Powered_by_Stripe_blurple.png" width="110" alt="Powered by Stripe" style="display:block;border:0;margin-bottom:10px;">
    You're receiving this because you created a TradeSura account. <a href="${base}/privacy" style="color:${EMAIL.muted};">Privacy policy</a> · <a href="mailto:${SUPPORT_EMAIL}" style="color:${EMAIL.muted};">Help</a><br>`;

  return {
    subject: `Welcome to TradeSura, ${e.firstName || "there"}`,
    html: emailShell({
      title: `Welcome to TradeSura, ${e.firstName || "there"}`,
      preheader: "Your free account is ready. Build your first plan and set up payments in about 10 minutes.",
      rows,
      footerExtra,
    }),
  };
}
