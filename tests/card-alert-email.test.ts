import { describe, expect, it } from "vitest";
import type { CardDetails } from "@/lib/admin/card-check";
import { cardAlertEmail, readVerdict, type CardAlertRead } from "@/lib/card-alert-email";
import { COMPANY_LINE, withCompanyFooter } from "@/lib/email-layout";

// 3.2: the card-upload alert to the team, on the same chrome as the other
// emails. Matt, 26 Nov: with both numbers, the automatic read and the photos.

const details: CardDetails = {
  source: "automatic",
  outcome: "read",
  complete: true,
  licenceNo: "1234567",
  registrationNo: "584123",
  name: "Dave Wood",
  company: "Wood Heating",
  expiresOn: "2027-06-30",
  categories: ["Central heating boilers", "Gas fires"],
  notes: [],
  readAt: "2026-11-02T14:05:30.000Z",
  readBy: null,
  backRead: true,
  suspect: false,
};
const clean: CardAlertRead = { automatic: "passed", details, reasons: ["Read in full with nothing to check: ready to pass."], concerns: [], autoPassed: false };
const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9]), type: "image/jpeg" };
const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: "image/png" };

const base = {
  business: "Wood Heating",
  licenceNo: "1234567",
  registrationNo: "584123",
  from: "signup" as const,
  at: new Date("2026-11-02T14:05:00Z"),
  link: "https://admin.tradesura.example/verification/cm7abc123def456ghi789jkl0",
  read: clean,
  photos: { front: jpeg, back: png, backSent: true },
};

describe("card-upload alert email", () => {
  it("names the business in the subject and gives its details", () => {
    const { subject, html } = cardAlertEmail(base);
    expect(subject).toBe("Gas Safe card to check: Wood Heating");
    expect(html).toContain("has just signed up and sent their Gas Safe ID card");
    expect(html).toContain("Mon 2 Nov, 14:05 UK time");
    expect(html).toContain("Sign-up");
  });

  it("gives the registration number as well as the licence number", () => {
    const { html } = cardAlertEmail(base);
    expect(html).toMatch(/Licence number<\/td>\s*<td[^>]*>1234567<\/td>/);
    expect(html).toMatch(/Registration number<\/td>\s*<td[^>]*>584123<\/td>/);
  });

  it("says when the card is a new one from Settings", () => {
    const { html } = cardAlertEmail({ ...base, from: "settings" });
    expect(html).toContain("has just uploaded a new Gas Safe ID card in Settings");
  });

  it("shows the upload in UK time, summer time included", () => {
    expect(cardAlertEmail({ ...base, at: new Date("2026-07-01T13:05:00Z") }).html).toContain("Wed 1 Jul, 14:05 UK time");
  });

  it("links the button to the check page, and says where to go without one", () => {
    expect(cardAlertEmail(base).html).toContain(`href="${base.link}"`);
    expect(cardAlertEmail(base).html).toContain("Check the card");
    const { html } = cardAlertEmail({ ...base, link: null });
    expect(html).not.toContain("Check the card");
    expect(html).toContain("go to <b>Verification</b>");
  });

  it("says when a number wasn't given", () => {
    const { html } = cardAlertEmail({ ...base, licenceNo: null, registrationNo: null, read: null });
    expect(html.match(/Not given/g)).toHaveLength(2);
    expect(html).not.toContain("null");
  });

  it("escapes the business name, the numbers and what the read found", () => {
    const { html } = cardAlertEmail({
      ...base,
      business: `<img src=x onerror="alert(1)">`,
      licenceNo: "<b>1</b>",
      read: { ...clean, details: { ...details, name: "<script>x</script>", notes: ["<i>glare</i>"] } },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>1</b>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<i>glare</i>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("carries the company footer once, so sending doesn't add a second", () => {
    const { html } = cardAlertEmail(base);
    expect(html).toContain(COMPANY_LINE);
    expect(withCompanyFooter(html)).toBe(html);
  });
});

describe("the automatic read in the alert", () => {
  it("shows a clean read field by field, against what they gave", () => {
    const { html } = cardAlertEmail(base);
    expect(html).toContain("WHAT THE AUTOMATIC READ FOUND");
    expect(html).toContain("Read in full, nothing to flag");
    expect(html.match(/matches what they gave/g)).toHaveLength(2);
    expect(html).toContain("Dave Wood");
    expect(html).toContain("30 June 2027");
    expect(html).toContain("2 categories of work read");
    expect(html).toContain("Read in full with nothing to check: ready to pass.");
  });

  it("puts the result in the inbox preview", () => {
    const { html } = cardAlertEmail(base);
    expect(html).toContain("Wood Heating, licence 1234567, registration 584123. Automatic read: read in full, nothing to flag.");
  });

  it("says when it passed on its own", () => {
    const { html } = cardAlertEmail({ ...base, read: { ...clean, autoPassed: true, reasons: ["It passed the card check automatically. The Gas Safe Register check is still to do."] } });
    expect(html).toContain("Read in full and passed automatically");
    expect(html).toContain("The Gas Safe Register check is still to do.");
  });

  it("flags a number that isn't the one they gave", () => {
    const concern = "The card's licence number, 1234567, isn't the 7654321 they gave.";
    const { html } = cardAlertEmail({ ...base, licenceNo: "7654321", read: { ...clean, reasons: [concern], concerns: [concern] } });
    expect(html).toContain("Read in full, with 1 thing to check");
    expect(html).toContain("they gave 7654321");
    expect(html).toContain(concern);
    expect(html.match(/matches what they gave/g)).toHaveLength(1);
  });

  it("says why a read failed, with nothing made up for the fields", () => {
    const failed: CardAlertRead = {
      automatic: "failed",
      details: { ...details, outcome: "not_a_card", licenceNo: null, registrationNo: null, name: null, expiresOn: null, categories: [] },
      reasons: ["The automatic check says the photo isn't a Gas Safe ID card."],
      concerns: [],
      autoPassed: false,
    };
    const { html } = cardAlertEmail({ ...base, read: failed });
    expect(html).toContain("Didn't pass the automatic read");
    expect(html).toContain("isn't a Gas Safe ID card");
    expect(html).not.toContain("Name on card");
  });

  it("marks what it couldn't read, with the read's own note", () => {
    const partial: CardAlertRead = {
      automatic: "failed",
      details: { ...details, complete: false, expiresOn: null, notes: ["Glare covers the expiry date."] },
      reasons: ["It couldn't read the card's expiry date: Glare covers the expiry date."],
      concerns: [],
      autoPassed: false,
    };
    const { html } = cardAlertEmail({ ...base, read: partial });
    expect(html).toMatch(/Expires<\/td>\s*<td[^>]*><span[^>]*>Couldn't read it/);
    // The note is already in the reason, so it's said once.
    expect(html.match(/Glare covers the expiry date\./g)).toHaveLength(1);
  });

  it("says when the read is still going, or isn't set up", () => {
    const waiting = (reason: string): CardAlertRead => ({ automatic: "waiting", details: null, reasons: [reason], concerns: [], autoPassed: false });
    expect(cardAlertEmail({ ...base, read: waiting("The automatic check is still reading the card.") }).html).toContain("still reading the card");
    const { html } = cardAlertEmail({ ...base, read: waiting("The automatic check isn't set up, so a person reads the card.") });
    expect(html).toContain("Not read yet");
    expect(html).toContain("isn't set up");
  });

  it("says the result isn't available when the read couldn't be looked up, not that there's no photo (QA, 26 Nov)", () => {
    const { html, attachments } = cardAlertEmail({ ...base, read: null });
    expect(html).toContain("Read result not available");
    expect(html).toContain("couldn't be looked up when this email was sent");
    expect(html).toContain("Automatic read: read result not available.");
    expect(html).not.toContain("no card photo");
    // The photos still show beneath it.
    expect(attachments.map((a) => a.contentId)).toEqual(["card-front", "card-back"]);
  });

  it("says there's no card photo only when there really isn't one", () => {
    const none: CardAlertRead = { automatic: null, details: null, reasons: ["There's no photo of their Gas Safe ID card yet."], concerns: [], autoPassed: false };
    const { html } = cardAlertEmail({ ...base, read: none, photos: { front: null, back: null, backSent: false } });
    expect(html).toContain("Not read: there's no card photo");
    expect(html).not.toContain("Read result not available");
  });

  it("sums up each result in a few words", () => {
    expect(readVerdict(null)).toEqual({ tone: "wait", text: "Read result not available" });
    expect(readVerdict({ ...clean, automatic: null })).toEqual({ tone: "wait", text: "Not read: there's no card photo" });
    expect(readVerdict(clean)).toEqual({ tone: "good", text: "Read in full, nothing to flag" });
    expect(readVerdict({ ...clean, concerns: ["a", "b"] })).toEqual({ tone: "warn", text: "Read in full, with 2 things to check" });
    expect(readVerdict({ ...clean, automatic: "failed" }).tone).toBe("bad");
  });
});

describe("the card photos in the alert", () => {
  it("shows the front and back inline, inside the email, linked to the check page", () => {
    const { html, attachments } = cardAlertEmail(base);
    expect(html).toContain(`<img src="cid:card-front"`);
    expect(html).toContain(`<img src="cid:card-back"`);
    expect(html).toMatch(new RegExp(`<a href="${base.link}"[^>]*><img src="cid:card-front"`));
    expect(attachments).toEqual([
      { filename: "gas-safe-card-front.jpg", content: Buffer.from(jpeg.bytes), contentType: "image/jpeg", contentId: "card-front" },
      { filename: "gas-safe-card-back.png", content: Buffer.from(png.bytes), contentType: "image/png", contentId: "card-back" },
    ]);
  });

  it("says when no back was sent", () => {
    const { html, attachments } = cardAlertEmail({ ...base, photos: { front: jpeg, back: null, backSent: false } });
    expect(html).toContain("No photo of the back was sent.");
    expect(html).not.toContain("cid:card-back");
    expect(attachments.map((a) => a.contentId)).toEqual(["card-front"]);
  });

  it("points to the check page for a photo a mail client can't show, or one that couldn't be opened", () => {
    const { html, attachments } = cardAlertEmail({ ...base, photos: { front: { bytes: new Uint8Array([1]), type: "image/heic" }, back: null, backSent: true } });
    expect(attachments).toEqual([]);
    expect(html.match(/Couldn't show this photo here\. It's on the check page\./g)).toHaveLength(2);
    expect(cardAlertEmail({ ...base, link: null, photos: { front: null, back: null, backSent: false } }).html).toContain("It's in TradeSura Admin.");
  });
});
