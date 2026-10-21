// The one-time code email (2026 Build Guide mock-up, 15 Oct). Subject puts
// the code first so iOS offers to autofill it from the notification.
import { EMAIL, emailShell, escapeHtml } from "@/lib/email-layout";

export function codeEmail(opts: {
  code: string;
  firstName?: string | null;
  expiresAt: Date;
  /** What the code is for, as the end of "here's your code to …". */
  purpose?: string;
}) {
  const expiry = opts.expiresAt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const hi = opts.firstName ? `Hi ${escapeHtml(opts.firstName)}, here's` : "Here's";
  const rows = `
  <tr><td style="padding:28px 28px 8px;font-size:16px;line-height:24px;">
    ${hi} your code to ${opts.purpose ?? "verify your email"}:
  </td></tr>
  <tr><td align="center" style="padding:10px 28px;">
    <div style="display:inline-block;background:${EMAIL.wash};border:1px solid #DCE3EC;border-radius:12px;padding:14px 26px;font-size:36px;letter-spacing:10px;font-weight:700;color:${EMAIL.ink};">${opts.code}</div>
  </td></tr>
  <tr><td style="padding:12px 28px 6px;font-size:15px;line-height:22px;color:${EMAIL.body};">
    Enter it in the TradeSura app. It works once and lasts <b>10 minutes</b> (until ${expiry} UK time).
  </td></tr>
  <tr><td style="padding:10px 28px 26px;font-size:13px;line-height:20px;color:${EMAIL.muted};">
    Didn't ask for this? Just ignore this email, your account is safe.
  </td></tr>`;
  return {
    subject: `${opts.code} is your TradeSura code`,
    html: emailShell({
      title: `${opts.code} is your TradeSura code`,
      preheader: `Enter ${opts.code} in the TradeSura app. It lasts 10 minutes.`,
      width: 480,
      rows,
    }),
  };
}
