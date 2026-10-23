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

const engineer = {
  id: "e1",
  firstName: "Matthew",
  tradingName: "MW Heating",
  legalName: "TRADESURA LTD",
  slug: "mw-heating",
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

  it("uses the engineer's 80%: £115 a year per £12 customer, not £144", async () => {
    expect(engineerYearlyPence(1200)).toBe(11520);
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toContain("£115 a year to you");
    expect(html).toContain("£1,152 a year");
    expect(html).not.toContain("£144");
  });

  it("has the real logo and the company footer", async () => {
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    expect(html).toMatch(/<img src="https:\/\/[^"]+\/brand\/lockup\.png"/);
    expect(html).toContain("company no. 17325346");
  });

  it("lists the app's 7 setup steps in the hub's order, with an Outlook-safe button", async () => {
    m.engineer.mockResolvedValue(engineer);
    const { html } = await engineerWelcomeEmailHtml("e1");
    const order = ["Build your first plan", "Get paid", "Get found on Google", "Connect your website", "Bring in your customers", "Invite engineers you know", "Member pack"];
    const at = order.map((t) => html.indexOf(`<b>${t}</b>`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(html).toContain("0 of 7 done");
    expect(html).toContain("<v:roundrect");
    expect(html).not.toContain("Gas Safe verified");
  });
});
