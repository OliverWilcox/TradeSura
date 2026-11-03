import { describe, expect, it } from "vitest";
import { cardAlertEmail } from "@/lib/card-alert-email";
import { COMPANY_LINE, withCompanyFooter } from "@/lib/email-layout";

// 3.2: the card-upload alert to the team, on the same chrome as the other emails.

const base = {
  business: "Wood Heating",
  gasSafeNo: "612844",
  from: "signup" as const,
  at: new Date("2026-11-02T14:05:00Z"),
  link: "https://admin.tradesura.example/verification/cm7abc123def456ghi789jkl0",
};

describe("card-upload alert email", () => {
  it("names the business in the subject and gives its details", () => {
    const { subject, html } = cardAlertEmail(base);
    expect(subject).toBe("Gas Safe card to check: Wood Heating");
    expect(html).toContain("has just signed up and sent their Gas Safe ID card");
    expect(html).toContain("612844");
    expect(html).toContain("Mon 2 Nov, 14:05 UK time");
    expect(html).toContain("Sign-up");
  });

  it("says when the card is a new one from Settings", () => {
    const { html } = cardAlertEmail({ ...base, from: "settings" });
    expect(html).toContain("has just uploaded a new Gas Safe ID card in Settings");
    expect(html).toContain("Settings");
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

  it("says when the Gas Safe number wasn't given", () => {
    const { html } = cardAlertEmail({ ...base, gasSafeNo: null });
    expect(html).toContain("Not given");
    expect(html).not.toContain("Gas Safe null");
  });

  it("escapes the business name and number", () => {
    const { html } = cardAlertEmail({ ...base, business: `<img src=x onerror="alert(1)">`, gasSafeNo: "<b>1</b>" });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>1</b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("carries the company footer once, so sending doesn't add a second", () => {
    const { html } = cardAlertEmail(base);
    expect(html).toContain(COMPANY_LINE);
    expect(withCompanyFooter(html)).toBe(html);
  });
});
