// The card-upload alert to the team (3.2, lib/card-alert.ts), on the same
// chrome as TradeSura's other emails. Internal: it goes only to the addresses
// in VERIFICATION_ALERT_EMAIL, never to an engineer. Matt, 26 Nov: it carries
// what's needed to judge the card from the inbox: both Gas Safe numbers, what
// the automatic read found (the Verification page's own verdict) and the
// front and back photos. The photos travel inside the email as inline images,
// never as a link into the private card store.
import type { AutomaticResult, CardDetails } from "@/lib/admin/card-check";
import type { EmailAttachment } from "@/lib/email";
import { EMAIL, emailButton, emailShell, escapeHtml } from "@/lib/email-layout";
import { gasSafeRegisterLink, gasSafeRegisterSearch } from "@/lib/gas-safe-register-link";

/** "Mon 2 Nov, 14:05": the upload time, UK time. */
function ukTime(at: Date): string {
  const day = at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" });
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return `${day}, ${time}`;
}

/** "30 June 2027", for the card's expiry (a date with no time). */
const cardDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export type CardFrom = "signup" | "settings" | "team";

/** What the automatic read found, summed up as the Verification page does (lib/admin/card-check). */
export type CardAlertRead = {
  automatic: AutomaticResult | null;
  details: CardDetails | null;
  /** Why it needs a person, in the Verification page's words; the concerns are among them. */
  reasons: string[];
  concerns: string[];
  /** This read passed the card check on its own. */
  autoPassed: boolean;
};

export type CardAlertPhoto = { bytes: ArrayBuffer | Uint8Array; type: string };

/** Image types mail clients show inline. A HEIC photo, say, is left for the check page. */
const SHOWABLE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

const TONE = {
  good: { ink: "#17663F", wash: "#E8F6EF" },
  warn: { ink: "#8A5300", wash: "#FFF4DE" },
  bad: { ink: "#B42318", wash: "#FDECEA" },
  wait: { ink: EMAIL.body, wash: EMAIL.wash },
} as const;

type Tone = keyof typeof TONE;

/** Said when the read couldn't be looked up (read is null): nothing about the card itself, which may well be fine. */
const UNAVAILABLE = "The automatic read couldn't be looked up when this email was sent. Its result is on the check page in TradeSura Admin.";

/** The read's result in a few words, for the box and the inbox preview. */
export function readVerdict(read: CardAlertRead | null): { tone: Tone; text: string } {
  if (!read) return { tone: "wait", text: "Read result not available" };
  if (!read.automatic) return { tone: "wait", text: "Not read: there's no card photo" };
  if (read.automatic === "waiting") return { tone: "wait", text: "Not read yet" };
  if (read.automatic === "failed") return { tone: "bad", text: "Didn't pass the automatic read" };
  const n = read.concerns.length;
  if (n) return { tone: "warn", text: `Read in full, with ${n === 1 ? "1 thing" : `${n} things`} to check` };
  return { tone: "good", text: read.autoPassed ? "Read in full and passed automatically" : "Read in full, nothing to flag" };
}

const sectionLabel = (text: string) =>
  `<tr><td style="padding:22px 32px 8px;font-size:11px;letter-spacing:1.2px;font-weight:700;color:${EMAIL.muted};">${text}</td></tr>`;

function tableRows(rows: [string, string][], ruleFirst = false): string {
  return rows
    .map(([label, value], i) => {
      const rule = i || ruleFirst ? `border-top:1px solid ${EMAIL.line};` : "";
      return `<tr>
      <td valign="top" width="40%" style="${rule}padding:12px 16px;font-size:13px;line-height:20px;color:${EMAIL.muted};">${label}</td>
      <td valign="top" style="${rule}padding:12px 16px;font-size:15px;line-height:20px;font-weight:700;color:${EMAIL.ink};word-break:break-word;">${value}</td>
    </tr>`;
    })
    .join("");
}

const boxed = (inner: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${EMAIL.line};border-radius:12px;border-collapse:separate;">${inner}</table>`;

const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
const aside = (tone: Tone, html: string) => ` <span style="font-size:13px;font-weight:400;color:${TONE[tone].ink};">${html}</span>`;
const UNREAD = `<span style="font-weight:400;color:${TONE.bad.ink};">Couldn't read it</span>`;

/** The number on the card, set against the one they gave. */
function compared(onCard: string | null, given: string | null): string {
  if (!onCard) return UNREAD;
  if (!given) return escapeHtml(onCard);
  return digits(onCard) === digits(given)
    ? `${escapeHtml(onCard)}${aside("good", "&#10003; matches what they gave")}`
    : `${escapeHtml(onCard)}${aside("bad", `they gave ${escapeHtml(given)}`)}`;
}

function readSection(read: CardAlertRead | null, given: { licenceNo: string | null; registrationNo: string | null }): string {
  const verdict = readVerdict(read);
  const d = read?.details?.outcome === "read" ? read.details : null;
  const rows: [string, string][] = d
    ? [
        ["Licence number", compared(d.licenceNo, given.licenceNo)],
        ["Registration number", compared(d.registrationNo, given.registrationNo)],
        ["Name on card", d.name ? escapeHtml(d.name) : UNREAD],
        ["Expires", d.expiresOn ? cardDate(d.expiresOn) : UNREAD],
        ["Back of card", d.backRead ? `${d.categories.length} ${d.categories.length === 1 ? "category" : "categories"} of work read` : "No photo of the back"],
      ]
    : [];
  // The read's own notes (glare, a cut-off digit) unless a reason already quotes them.
  const reasons = read ? read.reasons : [UNAVAILABLE];
  const notes = (read?.details?.notes ?? []).filter((n) => !reasons.some((r) => r.includes(n)));
  const points = [...new Set([...reasons, ...notes])];
  const list = points.length
    ? `<tr><td colspan="2" style="border-top:1px solid ${EMAIL.line};padding:10px 16px 12px;">${points
        .map((p) => `<div style="padding:3px 0 3px 14px;text-indent:-14px;font-size:14px;line-height:20px;color:${EMAIL.body};">&bull;&nbsp; ${escapeHtml(p)}</div>`)
        .join("")}</td></tr>`
    : "";
  const tone = TONE[verdict.tone];
  const head = `<tr><td colspan="2" style="background:${tone.wash};border-radius:${rows.length || list ? "11px 11px 0 0" : "11px"};padding:12px 16px;font-size:15px;line-height:20px;font-weight:700;color:${tone.ink};">${escapeHtml(verdict.text)}</td></tr>`;
  return `${sectionLabel("WHAT THE AUTOMATIC READ FOUND")}
  <tr><td style="padding:0 32px;">${boxed(`${head}${tableRows(rows, true)}${list}`)}</td></tr>`;
}

type Shown = { cid: string; attachment: EmailAttachment } | null;

function inline(photo: CardAlertPhoto | null, side: "front" | "back"): Shown {
  const ext = photo ? SHOWABLE[photo.type] : undefined;
  if (!photo || !ext) return null;
  const cid = `card-${side}`;
  return { cid, attachment: { filename: `gas-safe-card-${side}.${ext}`, content: Buffer.from(new Uint8Array(photo.bytes)), contentType: photo.type, contentId: cid } };
}

function photoCell(label: string, shown: Shown, missing: string, alt: string, link: string | null, pad: string): string {
  const note = (text: string) =>
    `<div style="background:${EMAIL.wash};border:1px dashed ${EMAIL.line};border-radius:8px;padding:22px 12px;font-size:13px;line-height:19px;color:${EMAIL.muted};text-align:center;">${text}</div>`;
  const img = shown
    ? `<img src="cid:${shown.cid}" width="260" alt="${alt}" style="display:block;width:100%;max-width:260px;height:auto;border:1px solid ${EMAIL.line};border-radius:8px;">`
    : null;
  const body = img ? (link ? `<a href="${escapeHtml(link)}" style="text-decoration:none;">${img}</a>` : img) : note(missing);
  return `<td width="50%" valign="top" style="${pad}">
      <div style="font-size:12px;font-weight:700;color:${EMAIL.body};padding-bottom:6px;">${label}</div>
      ${body}
    </td>`;
}

export function cardAlertEmail(opts: {
  business: string;
  licenceNo: string | null;
  registrationNo: string | null;
  from: CardFrom;
  at: Date;
  /** The check page in TradeSura Admin; null when ADMIN_APP_URL isn't set. */
  link: string | null;
  /** The automatic read; null when it couldn't be looked up. */
  read: CardAlertRead | null;
  photos: { front: CardAlertPhoto | null; back: CardAlertPhoto | null; backSent: boolean };
}): { subject: string; html: string; attachments: EmailAttachment[] } {
  const business = escapeHtml(opts.business);
  const what = {
    signup: `<b>${business}</b> has just signed up and sent their Gas Safe ID card.`,
    settings: `<b>${business}</b> has just uploaded a new Gas Safe ID card in Settings.`,
    team: `<b>${business}</b> has just added a staff engineer, with their Gas Safe ID card.`,
  }[opts.from];
  const given = (v: string | null) => (v ? escapeHtml(v) : `<span style="font-weight:400;color:${EMAIL.muted};">Not given</span>`);
  const details: [string, string][] = [
    ["Business", business],
    ["Licence number", given(opts.licenceNo)],
    ["Registration number", given(opts.registrationNo)],
    ["Uploaded", `${ukTime(opts.at)} UK time`],
    ["Sent from", { signup: "Sign-up", settings: "Settings", team: "Team (staff engineer)" }[opts.from]],
  ];

  const front = inline(opts.photos.front, "front");
  const back = opts.photos.backSent ? inline(opts.photos.back, "back") : null;
  const elsewhere = opts.link ? "Couldn't show this photo here. It's on the check page." : "Couldn't show this photo here. It's in TradeSura Admin.";
  const photos = `${sectionLabel("THE CARD")}
  <tr><td style="padding:0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    ${photoCell("Front", front, elsewhere, "Front of their Gas Safe ID card", opts.link, "padding-right:8px;")}
    ${photoCell("Back", back, opts.photos.backSent ? elsewhere : "No photo of the back was sent.", "Back of their Gas Safe ID card", opts.link, "padding-left:8px;")}
    </tr></table>
  </td></tr>`;

  const action = opts.link
    ? `<tr><td style="padding:24px 32px 6px;">${emailButton(escapeHtml(opts.link), "Check the card")}</td></tr>`
    : `<tr><td style="padding:22px 32px 0;font-size:15px;line-height:22px;color:${EMAIL.body};">Open TradeSura Admin and go to <b>Verification</b> to check it.</td></tr>`;
  const search = gasSafeRegisterSearch(opts.licenceNo || opts.registrationNo ? opts : (opts.read?.details ?? null));
  const rows = `
  <tr><td style="padding:28px 32px 6px;">
    <div style="font-size:22px;line-height:28px;font-weight:700;color:${EMAIL.ink};padding-bottom:14px;">Gas Safe card to check</div>
    <p style="margin:0 0 14px;font-size:15px;line-height:22px;color:${EMAIL.body};">${what}</p>
    <p style="margin:0 0 6px;font-size:15px;line-height:22px;color:${EMAIL.body};">Please check the card against the Gas Safe Register today.</p>
  </td></tr>
  ${sectionLabel("WHAT THEY GAVE")}
  <tr><td style="padding:0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${EMAIL.wash};border:1px solid ${EMAIL.line};border-radius:12px;border-collapse:separate;">
    ${tableRows(details)}
    </table>
  </td></tr>
  ${readSection(opts.read, opts)}
  ${photos}
  ${action}
  <tr><td style="padding:16px 32px 26px;font-size:13px;line-height:20px;color:${EMAIL.muted};">
    ${search ? `Gas Safe ${search.kind} number ${escapeHtml(search.number)}: ` : ""}<a href="${gasSafeRegisterLink()}" style="color:${EMAIL.link};">check it on the Gas Safe Register</a>.
  </td></tr>`;
  const footerExtra = "You're getting this because your address is on TradeSura's card-upload alerts.<br>";
  const subject = `Gas Safe card to check: ${opts.business}`;
  const numbers = [opts.licenceNo ? `licence ${opts.licenceNo}` : null, opts.registrationNo ? `registration ${opts.registrationNo}` : null].filter(Boolean).join(", ");
  return {
    subject,
    html: emailShell({
      title: subject,
      preheader: `${opts.business}${numbers ? `, ${numbers}` : ""}. Automatic read: ${readVerdict(opts.read).text.toLowerCase()}.`,
      rows,
      footerExtra,
    }),
    attachments: [front, back].filter((s): s is NonNullable<Shown> => !!s).map((s) => s.attachment),
  };
}
