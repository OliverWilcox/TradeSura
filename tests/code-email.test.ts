import { describe, expect, it } from "vitest";
import { codeEmail } from "@/lib/code-email";

describe("code email (2026 Build Guide mock-up)", () => {
  it("puts the code first in the subject so iOS can autofill it", () => {
    const { subject, html } = codeEmail({ code: "4291", firstName: "Matt", expiresAt: new Date(), purpose: "sign in" });
    expect(subject).toBe("4291 is your TradeSura code");
    expect(html).toContain("Hi Matt");
    expect(html).toContain("your code to sign in");
    expect(html).toContain("10 minutes");
  });

  it("escapes the first name", () => {
    const { html } = codeEmail({ code: "1111", firstName: "<b>x</b>", expiresAt: new Date() });
    expect(html).not.toContain("<b>x</b>");
  });
});
