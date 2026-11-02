// Matt, 30 Oct §11 — the "You're verified" email v2.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { verifiedEmail, yearlyForCustomers, type VerifiedEmailInput } from "@/lib/verified-email";

const base: VerifiedEmailInput = {
  firstName: "Dave",
  slug: "smithandsons",
  plan: { name: "Boiler Care", priceMonthlyPence: 1500 },
  founding: null,
  groupUrl: null,
};

describe("You're verified email", () => {
  it("matches the preview: 20 customers on a £15 plan is £2,880 a year to them", () => {
    expect(yearlyForCustomers(1500)).toBe(288000);
    const { subject, html } = verifiedEmail(base);
    expect(subject).toBe("You're verified, Dave!");
    expect(html).toContain("GAS SAFE CHECK PASSED");
    expect(html).toContain("£2,880 a year to you");
    expect(html).toContain("the app does the selling");
    expect(html).toContain("/smithandsons");
    expect(html).toContain("0330 223 8456");
    expect(html).toContain("/brand/verified-member-badge.png");
  });

  it("two Founding versions, or none", () => {
    const top = verifiedEmail({ ...base, founding: { kind: "top", town: "Holmfirth", keepDays: 60 } }).html;
    expect(top).toContain("first 3 in Holmfirth");
    expect(top).toContain("within <b>60 days</b>");
    const badge = verifiedEmail({ ...base, founding: { kind: "badge", town: "Holmfirth" } }).html;
    expect(badge).toContain("Founding Member badge");
    expect(badge).not.toContain("first 3 in");
    expect(verifiedEmail(base).html).not.toContain("FOUNDING MEMBER");
  });

  it("the installer group line only shows with a link, and no plan means no £ box", () => {
    expect(verifiedEmail(base).html).not.toContain("installer group");
    expect(verifiedEmail({ ...base, groupUrl: "https://chat.whatsapp.com/abc" }).html).toContain("Join the group");
    expect(verifiedEmail({ ...base, plan: null }).html).not.toContain("a year to you");
  });
});
