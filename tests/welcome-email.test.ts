import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ engineer: vi.fn(), tiers: vi.fn(), customers: vi.fn(), referrals: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: { findUniqueOrThrow: m.engineer, count: m.referrals },
    planTier: { count: m.tiers },
    customer: { count: m.customers },
  },
}));
import { engineerWelcomeEmailHtml, engineerYearlyPence } from "@/lib/engineer-welcome-email";
import { supportContactLine } from "@/lib/email-layout";

const engineer = {
  id: "e1",
  firstName: "Matthew",
  tradingName: "MW Heating",
  legalName: "TRADESURA LTD",
  slug: "mw-heating",
  referralCode: "WOOD25",
  packRequestedAt: null,
  stripeChargesEnabled: false,
  profilePublishedAt: null,
  websiteConnectedAt: null,
};

beforeEach(() => {
  m.tiers.mockResolvedValue(0);
  m.customers.mockResolvedValue(0);
  m.referrals.mockResolvedValue(0);
});

describe("welcome email (Build Review 3, P1)", () => {
  it("names the business, not TradeSura", async () => {
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toContain("MW Heating</b> now has a free TradeSura account");
  });

  it("falls back to the Companies House name", async () => {
    m.engineer.mockResolvedValue({ ...engineer, tradingName: null });
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toContain("TRADESURA LTD</b> now has a free TradeSura account");
  });

  it("uses the engineer's 80% and the letter's example: 20 × £15 = £2,880 a year", async () => {
    expect(engineerYearlyPence(1200)).toBe(11520);
    expect(engineerYearlyPence(1500)).toBe(14400);
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toContain("e.g. £144 a year on a £15 plan");
    expect(html).toContain("£2,880 a year");
    expect(html).toContain("Example:");
    expect(html).toContain("monthly or yearly by Direct Debit");
    expect(html).not.toContain("up to £");
    expect(html).not.toContain("£180");
  });

  it("has the real logo and the company footer", async () => {
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toMatch(/<img src="https:\/\/[^"]+\/brand\/lockup-dark\.png"/);
    expect(html).toContain("company no. 17325346");
  });

  it("never ticks the Gas Safe check or Get paid before they're really done", async () => {
    m.engineer.mockResolvedValue({ ...engineer, gasSafeCardUrl: "https://x/card.jpg", stripeChargesEnabled: true, stripePayoutsEnabled: false });
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toContain("Go live · 0 of 3 done");
    expect(html).toContain("<b>Gas Safe check</b>");
    expect(html).toContain("we're checking them");
  });

  it("lists the hub's Go live then Grow steps in order, with an Outlook-safe button", async () => {
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    const order = ["Build your first plan", "Gas Safe check", "Get paid", "Get found on Google", "Connect your website", "Bring in your customers", "Invite engineers you know"];
    const at = order.map((t) => html.indexOf(`<b>${t}</b>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("Go live · 0 of 3 done");
    expect(html).toContain("Your member pack</b> · posts when your Verified Member badge goes live");
    expect(html).toContain("<v:roundrect");
    expect(html).not.toContain("Gas Safe verified");
  });

  it("words the contact line as the verified email does: Call or WhatsApp us (Matt, 26 Nov)", async () => {
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toContain(`Any questions? ${supportContactLine()}`);
    expect(html).toContain(`Call or WhatsApp us on <a href="tel:+443302238456"`);
    expect(html).not.toContain("reply to this email or WhatsApp us on");
  });
});
