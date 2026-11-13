import { describe, expect, it } from "vitest";
import { noticeEmail } from "@/lib/admin/notice-email";
import { COMPANY_LINE } from "@/lib/email-layout";

// The admin's notices to an engineer (decisions, chases, pack posted, plan
// taken down) go out on the same chrome as TradeSura's other emails.

describe("admin notice email", () => {
  it("greets them by first name, with the heading, the paragraphs and the company footer", () => {
    const { subject, html } = noticeEmail({ firstName: "Matthew", title: "Your member pack is on its way", paragraphs: ["It's in the post today.", "Inside: your stickers."] });
    expect(subject).toBe("Your member pack is on its way");
    expect(html).toContain("Hi Matthew,");
    expect(html).toContain("Your member pack is on its way</div>");
    expect(html).toContain("It&#39;s in the post today.".replace("&#39;", "'"));
    expect(html).toContain("Inside: your stickers.");
    expect(html).toContain("brand/lockup-dark.png");
    expect(html).toContain(COMPANY_LINE);
  });

  it("says 'there' without a first name, and escapes what the admin typed", () => {
    const { html } = noticeEmail({ firstName: null, title: "Off sale", paragraphs: ['Reason: <b>"price"</b> & more'] });
    expect(html).toContain("Hi there,");
    expect(html).toContain("Reason: &lt;b&gt;&quot;price&quot;&lt;/b&gt; &amp; more");
    expect(html).not.toContain("<b>\"price\"</b>");
  });

  it("takes its own subject and preheader, and a button", () => {
    const { subject, html } = noticeEmail({ firstName: "Sam", title: "You're live", subject: "You're live on TradeSura", preheader: "Badge on from today", paragraphs: ["Go."], button: { href: "https://tradesura.com/x?a=1&b=2", label: "Open your page" } });
    expect(subject).toBe("You're live on TradeSura");
    expect(html).toContain("Badge on from today");
    expect(html).toContain('href="https://tradesura.com/x?a=1&amp;b=2"');
    expect(html).toContain("Open your page");
  });
});
