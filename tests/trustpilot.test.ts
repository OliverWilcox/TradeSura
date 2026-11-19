import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  engineers: [] as { id: string; email: string | null; firstName: string | null }[],
  events: [] as { name: string; meta: Record<string, unknown>; ts: Date }[],
  email: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: { findMany: vi.fn(async () => m.engineers) },
    event: {
      findMany: vi.fn(async () => m.events),
      findFirst: vi.fn(async ({ where }: { where: { meta: { equals: string } } }) => m.events.find((e) => e.meta.engineerId === where.meta.equals) ?? null),
      create: vi.fn(async ({ data }: { data: { name: string; meta: Record<string, unknown> } }) => {
        m.events.push({ name: data.name, meta: data.meta, ts: new Date("2026-11-13T08:00:00Z") });
        return data;
      }),
    },
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));

import { sendTrustpilotInvites, trustpilotInviteEmail, trustpilotInviteOf } from "@/lib/trustpilot";

beforeEach(() => {
  m.engineers = [
    { id: "a", email: "a@example.com", firstName: "Ann" },
    { id: "b", email: null, firstName: "Bob" },
  ];
  m.events = [];
  m.email.mockClear();
  vi.unstubAllEnvs();
});

describe("Trustpilot invites", () => {
  it("send nothing until the review link is set", async () => {
    vi.stubEnv("TRUSTPILOT_REVIEW_URL", "");
    expect(await sendTrustpilotInvites()).toBe(0);
    expect(m.email).not.toHaveBeenCalled();
    expect(await trustpilotInviteOf("a", new Date("2026-11-10T09:00:00Z"))).toEqual({ configured: false, sentAt: null, dueOn: "2026-11-13T09:00:00.000Z" });
  });

  it("go once to each live engineer with an email, and are recorded", async () => {
    vi.stubEnv("TRUSTPILOT_REVIEW_URL", "https://uk.trustpilot.com/evaluate/tradesura.com");
    expect(await sendTrustpilotInvites()).toBe(1);
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "a@example.com", subject: "How are you finding TradeSura?", html: expect.stringContaining("https://uk.trustpilot.com/evaluate/tradesura.com") }));
    expect(await sendTrustpilotInvites()).toBe(0);
    expect(m.events.map((e) => [e.name, e.meta.engineerId])).toEqual([["trustpilot_invite_sent", "a"]]);
    expect(await trustpilotInviteOf("a", new Date("2026-11-10T09:00:00Z"))).toEqual({ configured: true, sentAt: "2026-11-13T08:00:00.000Z", dueOn: null });
  });

  it("the email opens the review link, not the app", () => {
    const mail = trustpilotInviteEmail("Ann", "https://uk.trustpilot.com/evaluate/tradesura.com");
    expect(mail.html).toContain('href="https://uk.trustpilot.com/evaluate/tradesura.com"');
    expect(mail.html).not.toContain("/api/open?to=");
  });
});
