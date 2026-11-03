// WhatsApp Business Platform through Twilio — installer messages only. The
// automated number is a separate one from 0330 223 8456: a number on the API
// can't also be used in the WhatsApp app, and support chat stays a human on
// the app (mobile/lib/support.ts). Same Twilio account as lib/sms.ts.
import { twilioAuth } from "@/lib/twilio-auth";
import { cleanVar, renderTemplate, templateSids, WHATSAPP_TEMPLATES, type WhatsAppMessage } from "@/lib/whatsapp-templates";

export function whatsappConfigured(): boolean {
  return Boolean(twilioAuth() && process.env.TWILIO_WHATSAPP_FROM);
}

// Twilio's WhatsApp sandbox only takes free text to numbers that joined it,
// and has none of our templates — TWILIO_WHATSAPP_SANDBOX=1 sends the filled
// wording as a plain body so the whole path can be tried before Meta approves.
function sandbox() {
  return process.env.TWILIO_WHATSAPP_SANDBOX === "1";
}

/** Whether this message can go by WhatsApp right now (configured and its template approved). */
export function whatsappReady(template: WhatsAppMessage["template"]): boolean {
  return whatsappConfigured() && (sandbox() || Boolean(templateSids()[template]));
}

/**
 * Sends one installer message. Returns false (never throws) when it didn't go,
 * so the caller falls back to a text: not configured, template not approved,
 * or Twilio refused it (e.g. the number isn't on WhatsApp).
 */
export async function sendWhatsApp(to: string, message: WhatsAppMessage): Promise<boolean> {
  const auth = twilioAuth();
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!auth || !from) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[WhatsApp] to=${to} (${message.template})\n      ${renderTemplate(message)}`);
    }
    return false;
  }

  const params = new URLSearchParams({ To: `whatsapp:${to}`, From: `whatsapp:${from}` });
  if (sandbox()) {
    params.set("Body", renderTemplate(message));
  } else {
    const sid = templateSids()[message.template];
    if (!sid) return false;
    params.set("ContentSid", sid);
    const n = WHATSAPP_TEMPLATES[message.template].example.length;
    const vars = Object.fromEntries(
      Array.from({ length: n }, (_, i) => [String(i + 1), cleanVar(message.vars[i] ?? "")]),
    );
    if (n > 0) params.set("ContentVariables", JSON.stringify(vars));
  }

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${auth.accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: auth.authorization,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
    if (!res.ok) {
      console.error(`[WhatsApp] ${message.template} to ${to} failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[WhatsApp] ${message.template} to ${to} failed:`, err);
    return false;
  }
}
