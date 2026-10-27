// Build Review 3 §8 — account emails: each goes once, nudges only to new
// owner accounts, and the copy uses the engineer's 80%.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sentAt: {} as Record<string, Date | null>,
  findMany: vi.fn<(args: { where: Record<string, unknown> }) => Promise<{ id: string; email: string; firstName: string }[]>>(async () => []),
  email: vi.fn<(opts: { to: string; subject: string; html: string }) => Promise<undefined>>(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: {
      findMany: m.findMany,
      findUnique: vi.fn(async () => ({ id: "eng1", email: "eng@example.com", firstName: "Dave" })),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, Date> }) => {
        const field = Object.keys(data)[0];
        const key = `${where.id}:${field}`;
        if (m.sentAt[key]) return { count: 0 };
        m.sentAt[key] = data[field];
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, null> }) => {
        for (const f of Object.keys(data)) m.sentAt[`${where.id}:${f}`] = null;
      }),
    },
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));
vi.mock("@/lib/engineer-welcome-email", () => ({
  // 20% rounded down, so a £12 plan is £9.60 a month / £115 a year.
  engineerYearlyPence: (p: number) => (p - Math.floor(p * 0.2)) * 12,
}));

import {
  firstCustomerEmail,
  noPlanNudgeEmail,
  paymentsNudgeEmail,
  sendFirstPayoutEmail,
  sendSetupNudges,
} from "@/lib/account-emails";

beforeEach(() => {
  m.sentAt = {};
  m.email.mockClear();
  m.findMany.mockReset();
  m.findMany.mockResolvedValue([]);
});

describe("account emails", () => {
  it("day 1 and day 3 nudges go once each to new owner accounts", async () => {
    const now = new Date("2026-10-27T08:00:00Z");
    m.findMany.mockResolvedValue([{ id: "eng1", email: "eng@example.com", firstName: "Dave" }]);
    expect(await sendSetupNudges(now)).toEqual({ payments: 1, noPlan: 1 });
    expect(await sendSetupNudges(now)).toEqual({ payments: 0, noPlan: 0 });
    expect(m.email).toHaveBeenCalledTimes(2);

    const [payments, noPlan] = m.findMany.mock.calls.map((c) => c[0].where);
    for (const w of [payments, noPlan]) {
      expect(w).toMatchObject({ ownerId: null, deletedAt: null, bannedAt: null });
    }
    expect(payments).toMatchObject({ stripeChargesEnabled: false, paymentsNudgeEmailAt: null });
    expect(noPlan).toMatchObject({ noPlanNudgeEmailAt: null, tiers: { none: { status: "LIVE" } } });
    // Day 1 = at least a day old, day 3 = three; nothing older than 14 days.
    const day = 24 * 60 * 60 * 1000;
    expect((payments.createdAt as { lte: Date }).lte.getTime()).toBe(now.getTime() - day);
    expect((noPlan.createdAt as { lte: Date }).lte.getTime()).toBe(now.getTime() - 3 * day);
    expect((payments.createdAt as { gte: Date }).gte.getTime()).toBe(now.getTime() - 14 * day);
  });

  it("a failed send is retried on the next run", async () => {
    m.findMany.mockResolvedValue([{ id: "eng1", email: "eng@example.com", firstName: "Dave" }]);
    m.email.mockRejectedValueOnce(new Error("provider down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendSetupNudges();
    expect(m.sentAt["eng1:paymentsNudgeEmailAt"]).toBeNull();
    await sendSetupNudges();
    expect(m.sentAt["eng1:paymentsNudgeEmailAt"]).toBeInstanceOf(Date);
    errors.mockRestore();
  });

  it("the first payout email goes once", async () => {
    await sendFirstPayoutEmail("eng1", 4321);
    await sendFirstPayoutEmail("eng1", 9999);
    expect(m.email).toHaveBeenCalledTimes(1);
    expect(m.email.mock.calls[0][0].html).toContain("£43.21");
  });

  it("copy uses the engineer's 80% and links into the app", () => {
    expect(paymentsNudgeEmail("Dave").html).toContain("£9.60");
    expect(paymentsNudgeEmail("Dave").html).toContain("/api/open?to=get-paid");
    expect(noPlanNudgeEmail("Dave").html).toContain("£115 a year");
    const first = firstCustomerEmail("Dave", "Sarah Jones", "Boiler Care", 11520);
    expect(first.subject).toBe("Your first customer has joined");
    expect(first.html).toContain("Sarah Jones has joined Boiler Care");
    expect(first.html).toContain("£115 a year");
  });
});
