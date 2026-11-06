// Matt, 6 Nov — the Grow cards: who Pick your first 10 offers, the goal's
// pace and worth, and staff commission (owner-only).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  actor: { actorId: "o1", businessId: "o1", role: "owner" } as Record<string, string>,
  update: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: {
      update: m.update,
      findUniqueOrThrow: vi.fn(async () => ({ staffCommissionType: "signup", staffCommissionPence: 500 })),
      findMany: vi.fn(async () => []),
    },
    plan: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/auth", () => ({ getActor: vi.fn(async () => m.actor) }));
vi.mock("@/lib/track", () => ({ track: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));

import { commissionFor, engineerKeepsPence, firstTenCandidates, goalPace, londonMonth } from "@/lib/grow";
import { GET as getCommission, PUT as putCommission } from "@/app/api/grow/commission/route";

const now = new Date("2026-11-20T12:00:00Z");
const customer = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  firstName: "Sam",
  lastName: "Hill",
  phone: "+447700900001",
  smsOptOut: false,
  plans: [] as { status: string; offerSource: string | null }[],
  properties: [] as { appliances: { lastServicedAt: Date | null; installedAt: Date | null }[] }[],
  ...over,
});

describe("Pick your first 10", () => {
  it("leaves out customers on a plan, without a UK mobile, or opted out", () => {
    const list = firstTenCandidates(
      [
        customer({ id: "on", plans: [{ status: "ACTIVE", offerSource: null }] }),
        customer({ id: "paused", plans: [{ status: "PAUSED", offerSource: null }] }),
        customer({ id: "landline", phone: "+441273000000" }),
        customer({ id: "stop", smsOptOut: true }),
        customer({ id: "ok", plans: [{ status: "CANCELLED", offerSource: null }] }),
      ],
      now,
    );
    expect(list.map((c) => c.id)).toEqual(["ok"]);
  });

  it("puts landlords and recent work first, and marks who's been offered", () => {
    const list = firstTenCandidates(
      [
        customer({ id: "plain", firstName: "Abe" }),
        customer({
          id: "landlord",
          firstName: "Zoe",
          properties: [{ appliances: [{ lastServicedAt: new Date("2026-06-01"), installedAt: null }] }, { appliances: [] }],
          plans: [{ status: "PENDING", offerSource: "first10" }],
        }),
      ],
      now,
    );
    expect(list[0]).toMatchObject({ id: "landlord", hints: ["landlord", "recent", "regular"], offered: true });
    expect(list[1]).toMatchObject({ id: "plain", hints: [], offered: false });
  });
});

describe("First month goal", () => {
  it("is worth what the engineer keeps: the price less our 20%, rounded down in their favour", () => {
    expect(engineerKeepsPence(1300)).toBe(1040);
    expect(engineerKeepsPence(999)).toBe(800);
  });

  it("is behind once under the month's pace, but not in the first week", () => {
    expect(goalPace(10, 2, 15, 30)).toMatchObject({ pace: 5, behind: true });
    expect(goalPace(10, 5, 15, 30).behind).toBe(false);
    expect(goalPace(10, 0, 6, 30).behind).toBe(false);
    expect(goalPace(10, 10, 30, 30).behind).toBe(false);
  });

  it("counts from midnight on the 1st in London", () => {
    const winter = londonMonth(now);
    expect(winter.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(winter).toMatchObject({ day: 20, daysInMonth: 30 });
    // In summer London is an hour ahead, so the month starts at 23:00 UTC.
    expect(londonMonth(new Date("2026-07-15T12:00:00Z")).start.toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });
});

describe("Staff commission", () => {
  const monthStart = new Date("2026-11-01T00:00:00Z");
  const plans = [
    { activatedAt: new Date("2026-09-10"), cancelledAt: null },
    { activatedAt: new Date("2026-11-05"), cancelledAt: null },
    { activatedAt: new Date("2026-08-01"), cancelledAt: new Date("2026-09-15") },
    { activatedAt: null, cancelledAt: null }, // offered, never joined
  ];

  it("per sign-up: each plan that joined", () => {
    expect(commissionFor({ type: "signup", pence: 500 }, plans, monthStart, now)).toEqual({ thisMonthPence: 500, toDatePence: 1500 });
  });

  it("monthly: each month a plan was live", () => {
    // Sep–Nov (3) + Nov (1) + Aug–Sep (2) = 6 months; live this month: 2 plans.
    expect(commissionFor({ type: "monthly", pence: 100 }, plans, monthStart, now)).toEqual({ thisMonthPence: 200, toDatePence: 600 });
  });

  it("nothing without a rule", () => {
    expect(commissionFor(null, plans, monthStart, now)).toEqual({ thisMonthPence: 0, toDatePence: 0 });
  });

  beforeEach(() => {
    m.actor = { actorId: "o1", businessId: "o1", role: "owner" };
    m.update.mockClear();
  });

  it("staff can't see or set it", async () => {
    m.actor = { actorId: "s1", businessId: "o1", role: "staff" };
    expect((await getCommission()).status).toBe(403);
    const res = await putCommission(new Request("http://x", { method: "PUT", body: JSON.stringify({ type: "signup", pence: 500 }) }));
    expect(res.status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });

  it("the owner sets it", async () => {
    const res = await putCommission(new Request("http://x", { method: "PUT", body: JSON.stringify({ type: "monthly", pence: 100 }) }));
    expect(res.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith({ where: { id: "o1" }, data: { staffCommissionType: "monthly", staffCommissionPence: 100 } });
  });
});
