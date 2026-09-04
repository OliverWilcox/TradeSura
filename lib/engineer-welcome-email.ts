// Engineer signup welcome email. Table-based layout with inline styles
// throughout — same pattern as epc-builder/improveasy's email templates
// (Outlook and most mail clients don't support flexbox/grid/external CSS,
// so this can't reuse the app's own NativeWind-driven dark theme; a light
// body with a dark brand header band is the safe, standard shape).
import { prisma } from "@/lib/db";

const BLUE = "#1966CC";
const BLUE_DEEP = "#0F4C9E";
const NAVY = "#0B1A2E";
const MONEY = "#0E9F5B";
const INK = "#14202E";
const MUTED = "#5B6B7C";
const LINE = "#E1E8F0";
const WASH = "#F5F8FB";
const SUPPORT_EMAIL = "support@tradesura.com";

function wrapper(title: string, preheader: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${WASH};font-family:Arial,Helvetica,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;">${preheader}</span>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${WASH};padding:32px 16px;">
  <tr><td align="center">
    <table cellpadding="0" cellspacing="0" border="0" width="600"
      style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE};">
      <tr>
        <td bgcolor="${NAVY}" style="background-color:${NAVY};padding:28px 40px;">
          <span style="font-size:22px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">TRADE<span style="color:#5FA3F0;">SURA</span><span style="color:#3DD68C;">✓</span></span>
        </td>
      </tr>
      <tr><td style="padding:36px 40px 8px;">
        <p style="margin:0;font-size:24px;font-weight:900;color:${INK};line-height:30px;">${title}</p>
      </td></tr>
      ${body}
      <tr>
        <td bgcolor="${WASH}" style="background-color:${WASH};padding:20px 40px;border-top:1px solid ${LINE};">
          <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:${INK};">TradeSura</p>
          <p style="margin:0;font-size:11px;color:#8B95A1;">${SUPPORT_EMAIL} · tradesura.com</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

const STEPS: [string, string, string][] = [
  ["1", "Set up payments", "Connect Stripe — takes about 2 minutes, and you're paid out every Friday."],
  ["2", "Build your first plan", "Start from Boiler Care at £12/month, or set your own price and inclusions."],
  ["3", "Bring in your customers", "Import your book — every contact is a potential £144/year."],
];

export async function engineerWelcomeEmailHtml(engineerId: string) {
  const engineer = await prisma.engineer.findUniqueOrThrow({ where: { id: engineerId } });
  const firstName = engineer.firstName || "there";
  const brand = engineer.tradingName || "your business";
  const verified = Boolean(engineer.gasSafeNo && engineer.gasSafeVerifiedAt);

  const verifiedCard = verified
    ? `
      <tr><td style="padding:0 40px 24px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%"
          style="background-color:${WASH};border-radius:10px;border:1px solid ${LINE};">
          <tr><td style="padding:20px 24px;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:800;color:${MONEY};">✓ Gas Safe verified</p>
            <p style="margin:0;font-size:14px;color:${INK};">
              ${engineer.gasSafeName ?? ""}${engineer.gasSafeCompany ? ` · ${engineer.gasSafeCompany}` : ""}
              ${engineer.gasSafeNo ? ` · Licence ${engineer.gasSafeNo}` : ""}
            </p>
            ${engineer.gasSafeCategories ? `<p style="margin:4px 0 0;font-size:12.5px;color:${MUTED};">${engineer.gasSafeCategories}</p>` : ""}
          </td></tr>
        </table>
      </td></tr>`
    : "";

  const stepsHtml = STEPS.map(
    ([num, title, desc]) => `
      <tr>
        <td valign="top" style="padding:0 12px 16px 0;width:32px;">
          <div style="width:26px;height:26px;background-color:${BLUE};border-radius:50%;text-align:center;line-height:26px;font-size:12px;font-weight:900;color:#ffffff;">${num}</div>
        </td>
        <td valign="top" style="padding:2px 0 16px;">
          <p style="margin:0 0 2px;font-size:14px;font-weight:800;color:${INK};">${title}</p>
          <p style="margin:0;font-size:13px;color:${MUTED};line-height:19px;">${desc}</p>
        </td>
      </tr>`,
  ).join("");

  const body = `
    <tr><td style="padding:0 40px 20px;font-size:15px;color:${INK};line-height:24px;">
      Hi <strong>${firstName}</strong>, welcome to TradeSura.
    </td></tr>
    <tr><td style="padding:0 40px 24px;font-size:14px;color:${MUTED};line-height:23px;">
      ${brand} now has a free TradeSura account. Sell your own care plans at the end of the job —
      we collect the Direct Debit, you keep 80%, paid out every Friday.
    </td></tr>
    ${verifiedCard}
    <tr><td style="padding:0 40px 24px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"
        style="background-color:#ffffff;border-radius:10px;border:1px solid ${LINE};">
        <tr><td style="padding:24px;">
          <p style="margin:0 0 16px;font-size:13px;font-weight:800;color:${INK};letter-spacing:0.02em;">WHAT'S NEXT</p>
          <table cellpadding="0" cellspacing="0" border="0" width="100%">${stepsHtml}</table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 40px 28px;font-size:13px;color:${MUTED};line-height:22px;">
      Questions any time — reply to this email or reach us at
      <a href="mailto:${SUPPORT_EMAIL}" style="color:${BLUE_DEEP};font-weight:700;">${SUPPORT_EMAIL}</a>.
    </td></tr>`;

  return {
    subject: `Welcome to TradeSura, ${firstName} — you're set up`,
    html: wrapper(`You're in, ${firstName} 👋`, `Welcome to TradeSura — your free account is ready.`, body),
  };
}
