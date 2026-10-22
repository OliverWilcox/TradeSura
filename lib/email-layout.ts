// Shared chrome for TradeSura's own emails (2026 Build Guide email mock-ups):
// table layout + inline styles so it renders in Gmail, Outlook and Apple
// Mail. Light body with a navy brand band — email clients can't carry the
// app's dark theme reliably.
import { appUrl } from "@/lib/app-url";

export const EMAIL = {
  navy: "#0B1A2E",
  ink: "#0B1A2E",
  body: "#24324A",
  muted: "#5B6B82",
  line: "#E3E8EF",
  wash: "#F3F6FA",
  page: "#EEF2F7",
  blue: "#5FA3F0",
  link: "#2F7AD0",
  // Money only — £ figures, never ticks or buttons (Build Guide v2 Part 2).
  money: "#1F9E62",
} as const;

// Where replies to TradeSura's own emails land (Build Review 3, P2
// "Mailboxes" — a person keeps this inbox monitored). EMAIL_REPLY_TO
// overrides it per environment.
export const SUPPORT_EMAIL = "support@tradesura.com";

export const COMPANY_LINE =
  "TradeSura Ltd, registered in England and Wales, company no. 17325346. Registered office: Unit A3, Gateway Tower, 32 Western Gateway, London E16 1YL.";

// Email images need an absolute URL a mail client can actually fetch — not
// localhost, and not a login-protected Vercel preview. EMAIL_ASSET_URL
// overrides; otherwise a public https APP_URL, else the live site.
export function emailAssetBase(): string {
  const explicit = process.env.EMAIL_ASSET_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const app = appUrl();
  if (/^https:\/\//.test(app) && !/\.vercel\.app$/.test(new URL(app).hostname)) return app.replace(/\/$/, "");
  return "https://tradesura.com";
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function emailShell(opts: {
  title: string;
  preheader: string;
  width?: number;
  /** Rows (<tr>…</tr>) between the logo band and the footer. */
  rows: string;
  /** Extra footer HTML above the company line. */
  footerExtra?: string;
}): string {
  const width = opts.width ?? 600;
  const assets = emailAssetBase();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL.page};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${EMAIL.page};">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${EMAIL.ink};">
  <tr><td bgcolor="${EMAIL.navy}" style="background:${EMAIL.navy};padding:24px 30px;">
    <img src="${assets}/brand/lockup.png" width="160" height="32" alt="TradeSura" style="display:block;border:0;">
  </td></tr>
  ${opts.rows}
  <tr><td style="background:${EMAIL.wash};padding:18px 30px;font-size:11.5px;line-height:17px;color:${EMAIL.muted};">
    ${opts.footerExtra ?? ""}${COMPANY_LINE}
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// Build Review 3, P1 — "Every email needs the company footer". Emails built
// on emailShell already carry it; sendEmail() runs everything else (plain
// customer and staff notices) through this so no send can go out without it.
export function withCompanyFooter(html: string): string {
  if (html.includes(COMPANY_LINE)) return html;
  const footer = `<p style="margin:24px 0 0;padding-top:12px;border-top:1px solid ${EMAIL.line};font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:17px;color:${EMAIL.muted};">${COMPANY_LINE}</p>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : `${html}\n${footer}`;
}
