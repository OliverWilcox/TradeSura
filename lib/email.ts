// Thin email provider interface with a console/dev driver (CLAUDE.md §Stack).
// Real provider keys are a human task. Uses Resend — same provider as the
// epc-builder / improveasy-app projects — when RESEND_API_KEY is set;
// falls back to the dev driver otherwise, same pattern as lib/sms.ts.
import { Resend } from "resend";

// onboarding@resend.dev works with no domain setup (good for first testing);
// switch to a verified TradeSura domain address once one's added in the
// Resend dashboard (Domains → add tradesura.com → set the DNS records it
// gives you) — see .env.example.
const FROM = process.env.RESEND_FROM_EMAIL || "TradeSura <onboarding@resend.dev>";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  if (!_resend) _resend = new Resend(key);
  return _resend;
}

export async function sendEmail(opts: { to: string; subject: string; html: string }) {
  const resend = getResend();
  if (!resend) {
    console.log(
      `[EMAIL] to=${opts.to} subject="${opts.subject}"\n${opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400)}`,
    );
    return;
  }
  const { error } = await resend.emails.send({
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    console.error(`[EMAIL] Resend error sending to ${opts.to}:`, error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
