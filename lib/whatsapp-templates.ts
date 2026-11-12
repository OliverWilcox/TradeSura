// Installer messages on WhatsApp (Matt, 30 Oct: "we'll need the API for the
// automated installer messages"). WhatsApp only lets a business start a chat
// with a template Meta has approved word for word, so every automated
// message to an installer is one of these. `text` is the exact wording Matt
// submits in Twilio (Content Template Builder, category Utility); {{1}}…
// are the variables. Once approved, its Content SID (HX…) goes in
// TWILIO_WHATSAPP_TEMPLATES, keyed by the name below — until then that
// message keeps going by text.

export const WHATSAPP_TEMPLATES = {
  plan_joined: {
    text: "🎉 {{1}} just joined {{2}}: £{{3}} a year added. You now have {{4}} live, £{{5}} a month.",
    example: ["Pat Hughes", "Care", "180", "12 plans", "164"],
  },
  cancel_requested: {
    text: "TradeSura: {{1}} wants to cancel. Reason: {{2}}. {{3}}. Open TradeSura to see their details.",
    example: ["Pat Hughes", "Too expensive", "Plan ends 12 Nov. A quick call saves most customers"],
  },
  plan_kept: {
    text: "TradeSura: {{1}} is keeping their plan after all.",
    example: ["Pat Hughes"],
  },
  plan_switched: {
    text: "TradeSura: {{1}} switched to {{2}} ({{3}} a month) instead of cancelling.",
    example: ["Pat Hughes", "Service", "£10"],
  },
  plan_paused: {
    text: "TradeSura: {{1}} paused their plan until {{2}} instead of cancelling.",
    example: ["Pat Hughes", "12 February 2027"],
  },
  customer_moving: {
    text: "TradeSura: {{1}} is moving to {{2}} ({{3}}) and wants to keep their plan. Update their address in the TradeSura app.",
    example: ["Pat Hughes", "HD9 2AB", "on 3 December 2026"],
  },
  payment_failed: {
    text: "TradeSura: {{1}}'s {{2}} payment didn't go through. We've texted them a link to update their bank details. A quick call from you helps: {{3}}.",
    example: ["Pat Hughes", "£15", "07700 900123"],
  },
  plan_ended_unpaid: {
    text: "TradeSura: {{1}}'s plan has ended: their payment was still unpaid after {{2}} days.",
    example: ["Pat Hughes", "14"],
  },
  referral_signed_up: {
    text: "👋 {{1}} just signed up with your TradeSura referral link.",
    example: ["Smith Heating"],
  },
  referral_earning: {
    text: "💷 {{1}}'s first customer just paid. You now earn {{2}}% of our fee on every plan they sell.",
    example: ["Smith Heating", "25"],
  },
  low_rating: {
    text: "TradeSura: {{1}} rated their service {{2}}. You can reply publicly from Ratings in the TradeSura app.",
    example: ["Pat Hughes", "2 stars: \"Arrived late\""],
  },
  new_enquiry: {
    text: "New enquiry on TradeSura from {{1}}: \"{{2}}\" Open the app to reply.",
    example: ["Pat Hughes (07700 900123)", "Can you service my boiler next week?"],
  },
  new_owner_lead: {
    text: "New owner moving into {{1}} around {{2}}. The boiler's history is on the Home Passport, so they may want a plan.",
    example: ["14 Elm Grove", "3 Dec"],
  },
  passport_access: {
    text: "TradeSura: {{1}} ({{2}}) asked for access to the Home Passport at {{3}}. Check with the homeowner before sharing anything.",
    example: ["Sam Lee", "07700 900456", "14 Elm Grove, HD9 2AB"],
  },
  one_off_cp12: {
    text: "TradeSura: {{1}} asked for a one-off gas safety record before {{2}}, at your normal price. Their plan's own record isn't available until after their third payment.",
    example: ["Pat Hughes", "20 Dec 2026"],
  },
  top_spot_awarded: {
    text: "TradeSura: you've got a top spot in {{1}}, so your business now sits at the top of your town page. Sign your first customer by {{2}} to keep it.",
    example: ["Holmfirth", "1 January 2027"],
  },
  top_spot_released: {
    text: "TradeSura: your top spot in {{1}} has passed to the next Founding Member, as no customer joined within 60 days. You keep your Founding Member badge.",
    example: ["Holmfirth"],
  },
  top_spot_reminder: {
    text: "TradeSura: {{1}} days left to keep your top spot in {{2}}. Sign your first customer by {{3}}.",
    example: ["14", "Holmfirth", "1 January 2027"],
  },
  town_lead_founding: {
    text: "TradeSura: new homeowner request in {{1}} ({{2}}). As a Founding Member you get first pick for {{3}}. Open the app to claim it.",
    example: ["Holmfirth", "Pat in HD9", "24 hours"],
  },
  town_lead_open: {
    text: "TradeSura: new homeowner request in {{1}} ({{2}}). The first engineer to claim it gets it. Open the app to claim it.",
    example: ["Holmfirth", "Pat in HD9"],
  },
  gas_safe_verified: {
    text: "You're Gas Safe verified on TradeSura. Your member pack is on its way.",
    example: [],
    sentAs: "You're Gas Safe verified on TradeSura — your member pack is on its way.",
  },
  gas_safe_failed: {
    text: "We couldn't verify your Gas Safe number on TradeSura. Open the app to check it and try again.",
    example: [],
    sentAs: "We couldn't verify your Gas Safe number on TradeSura — open the app to check it and try again.",
  },
} as const satisfies Record<string, { text: string; example: readonly string[]; sentAs?: string }>;

export type WhatsAppTemplate = keyof typeof WHATSAPP_TEMPLATES;
export type WhatsAppMessage = { template: WhatsAppTemplate; vars: string[] };

// Meta rejects a send whose variable is empty or has a newline, a tab or
// more than four spaces in a row, so customer-typed text is flattened first.
export function cleanVar(v: string): string {
  const s = v.replace(/\s+/g, " ").trim().slice(0, 300);
  return s || "-";
}

/** The template's wording with its variables filled in — what the installer reads. */
export function renderTemplate(m: WhatsAppMessage): string {
  return WHATSAPP_TEMPLATES[m.template].text.replace(/\{\{(\d+)\}\}/g, (_, n) => cleanVar(m.vars[Number(n) - 1] ?? ""));
}

/** Content SIDs from TWILIO_WHATSAPP_TEMPLATES ({"plan_joined":"HX…"}); a bad value means none. */
export function templateSids(raw = process.env.TWILIO_WHATSAPP_TEMPLATES): Partial<Record<WhatsAppTemplate, string>> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([k, v]) => k in WHATSAPP_TEMPLATES && typeof v === "string" && /^HX[0-9a-f]{32}$/i.test(v),
      ),
    ) as Partial<Record<WhatsAppTemplate, string>>;
  } catch {
    console.error("[whatsapp] TWILIO_WHATSAPP_TEMPLATES isn't valid JSON — sending by text instead.");
    return {};
  }
}

// Messages with no variables are sent as fixed text by callers (e.g. Muhammad's
// admin verification flow), so they're matched back to their template here
// instead of changing every caller. `sentAs` is the caller's exact SMS text.
export function templateForFixedText(body: string): WhatsAppTemplate | null {
  for (const [key, t] of Object.entries(WHATSAPP_TEMPLATES)) {
    if (t.example.length === 0 && (t.text === body || ("sentAs" in t && t.sentAs === body))) return key as WhatsAppTemplate;
  }
  return null;
}
