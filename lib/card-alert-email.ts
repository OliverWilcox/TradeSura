// The card-upload alert to the team (3.2, lib/card-alert.ts), on the same
// chrome as TradeSura's other emails. Internal: it goes to the addresses in
// VERIFICATION_ALERT_EMAIL, never to an engineer, and says nothing about the
// engineer beyond their business and Gas Safe number.
import { EMAIL, emailButton, emailShell, escapeHtml } from "@/lib/email-layout";
import { gasSafeRegisterLink } from "@/lib/gas-safe-register-link";

/** "Mon 2 Nov, 14:05": the upload time, UK time. */
function ukTime(at: Date): string {
  const day = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${day}, ${time}`;
}

export type CardFrom = "signup" | "settings" | "team";

export function cardAlertEmail(opts: {
  business: string;
  gasSafeNo: string | null;
  /** Where the card came from: sign-up, a new card in Settings, or an owner adding a staff engineer. */
  from: CardFrom;
  at: Date;
  /** The check page in TradeSura Admin; null when ADMIN_APP_URL isn't set. */
  link: string | null;
}) {
  const business = escapeHtml(opts.business);
  const what = {
    signup: `<b>${business}</b> has just signed up and sent their Gas Safe ID card.`,
    settings: `<b>${business}</b> has just uploaded a new Gas Safe ID card in Settings.`,
    team: `<b>${business}</b> has just added a staff engineer, with their Gas Safe ID card.`,
  }[opts.from];
  const details: [string, string][] = [
    ["Business", business],
    ["Licence number", opts.gasSafeNo ? escapeHtml(opts.gasSafeNo) : "Not given"],
    ["Uploaded", `${ukTime(opts.at)} UK time`],
    ["Sent from", { signup: "Sign-up", settings: "Settings", team: "Team (staff engineer)" }[opts.from]],
  ];
  const table = details
    .map(([label, value], i) => {
      const rule = i ? `border-top:1px solid ${EMAIL.line};` : "";
      return `<tr>
      <td valign="top" width="40%" style="${rule}padding:12px 16px;font-size:13px;line-height:20px;color:${EMAIL.muted};">${label}</td>
      <td valign="top" style="${rule}padding:12px 16px;font-size:15px;line-height:20px;font-weight:700;color:${EMAIL.ink};word-break:break-word;">${value}</td>
    </tr>`;
    })
    .join("");
  const action = opts.link
    ? `<tr><td style="padding:22px 32px 6px;">${emailButton(escapeHtml(opts.link), "Check the card")}</td></tr>`
    : `<tr><td style="padding:20px 32px 0;font-size:15px;line-height:22px;color:${EMAIL.body};">Open TradeSura Admin and go to <b>Verification</b> to check it.</td></tr>`;
  const rows = `
  <tr><td style="padding:28px 32px 6px;">
    <div style="font-size:22px;line-height:28px;font-weight:700;color:${EMAIL.ink};padding-bottom:14px;">Gas Safe card to check</div>
    <p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${EMAIL.body};">${what}</p>
    <p style="margin:0 0 6px;font-size:15px;line-height:22px;color:${EMAIL.body};">Please check the card against the Gas Safe Register today.</p>
  </td></tr>
  <tr><td style="padding:12px 32px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL.wash};border:1px solid ${EMAIL.line};border-radius:12px;border-collapse:separate;">
    ${table}
    </table>
  </td></tr>
  ${action}
  <tr><td style="padding:16px 32px 26px;font-size:13px;line-height:20px;color:${EMAIL.muted};">
    ${opts.gasSafeNo ? `Gas Safe number ${escapeHtml(opts.gasSafeNo)}: ` : ""}<a href="${gasSafeRegisterLink()}" style="color:${EMAIL.link};">check it on the Gas Safe Register</a>.
  </td></tr>`;
  const footerExtra = "You're getting this because your address is on TradeSura's card-upload alerts.<br>";
  const subject = `Gas Safe card to check: ${opts.business}`;
  return {
    subject,
    html: emailShell({
      title: subject,
      preheader: `${opts.business}${opts.gasSafeNo ? `, Gas Safe ${opts.gasSafeNo}` : ""}. Please check it against the Gas Safe Register today.`,
      rows,
      footerExtra,
    }),
  };
}
