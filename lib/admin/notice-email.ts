// Notices the admin sends an engineer (a decision, a chase, a pack posted, a
// plan taken down), on the same chrome as TradeSura's other emails. One
// shape: a greeting, a heading, short paragraphs, an optional button.
import { EMAIL, emailButton, emailShell, escapeHtml } from "@/lib/email-layout";

export function noticeEmail(opts: {
  firstName: string | null | undefined;
  /** The heading inside the email; also the subject unless one is given. */
  title: string;
  subject?: string;
  /** What the inbox preview shows; the first paragraph when not given. */
  preheader?: string;
  /** Plain text, one entry per paragraph. */
  paragraphs: string[];
  button?: { href: string; label: string };
  /** Small print under the paragraphs. */
  note?: string;
}): { subject: string; html: string } {
  const hi = `Hi ${escapeHtml(opts.firstName?.trim() || "there")},`;
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${EMAIL.body};">${escapeHtml(p)}</p>`).join("");
  const action = opts.button ? `<tr><td style="padding:8px 32px 6px;">${emailButton(escapeHtml(opts.button.href), opts.button.label)}</td></tr>` : "";
  const note = opts.note ? `<tr><td style="padding:10px 32px 0;font-size:13px;line-height:20px;color:${EMAIL.muted};">${escapeHtml(opts.note)}</td></tr>` : "";
  const rows = `
  <tr><td style="padding:28px 32px 6px;">
    <p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${EMAIL.body};">${hi}</p>
    <div style="font-size:22px;line-height:28px;font-weight:700;color:${EMAIL.ink};padding-bottom:14px;">${escapeHtml(opts.title)}</div>
    ${body}
  </td></tr>
  ${action}
  ${note}
  <tr><td style="padding:0 0 26px;"></td></tr>`;
  const subject = opts.subject ?? opts.title;
  return {
    subject,
    html: emailShell({ title: subject, preheader: opts.preheader ?? opts.paragraphs[0] ?? subject, rows }),
  };
}
