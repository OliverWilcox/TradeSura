// Matt, 30 Oct §9.1 and §9.4 — "Finish setup to get paid" chasers, and the
// happy-moment emails (first customer, every payout).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  events: [] as { name: string; meta: Record<string, unknown> }[],
  engineer: { id: "eng1", email: "eng@example.com", firstName: "Dave", slug: "smithheating", firstPayoutEmailAt: new Date() as Date | null },
  email: vi.fn(async (_opts: { to: string; subject: string; html: string }) => undefined),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: {
      findUnique: vi.fn(async () => m.engineer),
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: vi.fn(async () => ({})),
    },
    event: {
      findFirst: vi.fn(async ({ where }: { where: { name: string; meta: { equals: string } } }) =>
        m.events.find((e) => e.name === where.name && Object.values(e.meta).includes(where.meta.equals)) ?? null,
      ),
    },
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));
vi.mock("@/lib/track", () => ({
  track: vi.fn(async (name: string, _actor: unknown, meta: Record<string, unknown>) => {
    m.events.push({ name, meta });
  }),
}));

import { happyMomentAsks, payoutEmail, sendPayoutEmail } from "@/lib/account-emails";
import { dueChaser } from "@/lib/finish-setup";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  m.events = [];
  m.email.mockClear();
  m.engineer.firstPayoutEmailAt = new Date();
  vi.unstubAllEnvs();
});

describe("finish setup chasers", () => {
  const asked = new Date("2026-11-02T10:00:00Z");
  const after = (days: number) => new Date(asked.getTime() + days * DAY + 60_000);

  it("chases on days 1, 3, 7 and 14, once each", () => {
    expect(dueChaser(asked, [], after(0))).toBeNull();
    expect(dueChaser(asked, [], after(1))).toBe(1);
    expect(dueChaser(asked, [1], after(2))).toBeNull();
    expect(dueChaser(asked, [1], after(3))).toBe(3);
    expect(dueChaser(asked, [1, 3, 7, 14], after(30))).toBeNull();
  });

  it("a missed run sends only the latest chaser, not a burst", () => {
    expect(dueChaser(asked, [], after(8))).toBe(7);
    expect(dueChaser(asked, [7], after(9))).toBeNull();
  });
});

describe("happy-moment emails", () => {
  it("ask about other customers and installers, with their code", () => {
    const html = happyMomentAsks("smithheating");
    expect(html).toContain("Who else have you worked for this year?");
    expect(html).toContain("smithheating");
    expect(html).toContain("25% of our fee");
  });

  it("only mention Trustpilot once there's a review link", () => {
    expect(happyMomentAsks(null)).not.toContain("Trustpilot");
    vi.stubEnv("TRUSTPILOT_REVIEW_URL", "https://uk.trustpilot.com/evaluate/tradesura.com");
    expect(happyMomentAsks(null)).toContain("Trustpilot");
  });

  it("every payout gets an email, once per payout", async () => {
    await sendPayoutEmail("eng1", "po_1", 4321);
    await sendPayoutEmail("eng1", "po_1", 4321);
    await sendPayoutEmail("eng1", "po_2", 1000);
    expect(m.email).toHaveBeenCalledTimes(2);
    expect(m.email.mock.calls[0][0].subject).toBe("£43.21 paid to your bank");
    expect(payoutEmail("Dave", 4321).html).toContain("Who else have you worked for this year?");
  });
});
