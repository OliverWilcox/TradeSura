import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  engineers: [] as Record<string, unknown>[],
  events: [] as { id: string; name: string; meta: Record<string, unknown>; ts: Date }[],
  offers: new Map<string, Date>(),
  push: vi.fn(async () => undefined),
  notify: vi.fn(async () => true),
  email: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: { findMany: vi.fn(async () => m.engineers) },
    event: {
      findMany: vi.fn(async ({ where }: { where: { meta: { equals: string } } }) => m.events.filter((e) => e.meta.engineerId === where.meta.equals)),
      create: vi.fn(async ({ data }: { data: { name: string; meta: Record<string, unknown> } }) => {
        const row = { id: `ev${m.events.length + 1}`, name: data.name, meta: data.meta, ts: new Date() };
        m.events.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { meta: Record<string, unknown> } }) => {
        const row = m.events.find((e) => e.id === where.id)!;
        row.meta = data.meta;
        return row;
      }),
    },
  },
}));
vi.mock("@/lib/admin/metrics", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/admin/metrics")>()),
  testMarks: vi.fn(async () => ({ engineers: [], customers: [], plans: [] })),
  realEngineerWhere: () => ({ deletedAt: null }),
  lastDeliveredOffers: vi.fn(async () => m.offers),
}));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: m.notify }));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));

import { dueFollowUp, followUpsSent, runFollowUpLadder } from "@/lib/follow-ups";

const DAY = 86_400_000;
const NOW = new Date("2026-11-13T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const engineer = (id: string, verifiedDaysAgo: number, extra: Record<string, unknown> = {}) => ({
  id,
  email: `${id}@example.com`,
  firstName: "Dave",
  gasSafeVerifiedAt: daysAgo(verifiedDaysAgo),
  expoPushToken: "ExponentPushToken[abc]",
  phone: "+447700900123",
  ...extra,
});

beforeEach(() => {
  m.engineers = [];
  m.events = [];
  m.offers = new Map();
  m.push.mockClear();
  m.notify.mockClear();
  m.email.mockClear();
});

describe("which step is due", () => {
  it("is the latest step reached that hasn't gone, never the call list", () => {
    expect(dueFollowUp(2, [])).toBeNull();
    expect(dueFollowUp(3, [])?.channel).toBe("push");
    expect(dueFollowUp(4, [1])).toBeNull();
    expect(dueFollowUp(5, [1])?.channel).toBe("whatsapp");
    expect(dueFollowUp(8, [])?.channel).toBe("email");
    expect(dueFollowUp(8, [3])).toBeNull();
    expect(dueFollowUp(12, [3])).toBeNull();
    expect(dueFollowUp(12, [])).toBeNull();
  });
});

describe("the daily ladder", () => {
  it("sends the step due, once, by the step's channel, and records it", async () => {
    m.engineers = [engineer("e3", 3), engineer("e5", 5), engineer("e7", 7), engineer("e1", 1), engineer("e10", 10)];
    const first = await runFollowUpLadder(NOW);
    expect(first.map((s) => [s.engineerId, s.step, s.channel, s.went])).toEqual([
      ["e3", 1, "push", true],
      ["e5", 2, "whatsapp", true],
      ["e7", 3, "email", true],
    ]);
    expect(m.push).toHaveBeenCalledWith("e3", "Your next customer is one tap away", expect.stringContaining("Offer a plan"), { url: "/customers" });
    expect(m.notify).toHaveBeenCalledWith("e5", expect.stringContaining("since your last plan offer"), { template: "no_activity", vars: [] });
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "e7@example.com", subject: "A week without a plan offer" }));
    expect(await runFollowUpLadder(NOW)).toEqual([]);
    expect(m.events.filter((e) => e.name === "follow_up_sent")).toHaveLength(3);
  });

  it("counts from the last delivered offer, and a new offer starts the ladder again", async () => {
    m.engineers = [engineer("e1", 40)];
    m.offers.set("e1", daysAgo(3));
    expect((await runFollowUpLadder(NOW)).map((s) => s.step)).toEqual([1]);
    expect(await runFollowUpLadder(new Date(NOW.getTime() + 1 * DAY))).toEqual([]);
    expect((await runFollowUpLadder(new Date(NOW.getTime() + 2 * DAY))).map((s) => s.step)).toEqual([2]);
    m.offers.set("e1", new Date(NOW.getTime() + 4 * DAY));
    expect(await runFollowUpLadder(new Date(NOW.getTime() + 5 * DAY))).toEqual([]);
    expect((await runFollowUpLadder(new Date(NOW.getTime() + 7 * DAY))).map((s) => s.step)).toEqual([1]);
    const sent = await followUpsSent("e1");
    expect(sent.map((s) => [s.step, s.channel, s.went])).toEqual([
      [1, "push", true],
      [2, "whatsapp", true],
      [1, "push", true],
    ]);
  });

  it("records a step that couldn't go (no device, no phone, no email) as not sent, and doesn't retry it", async () => {
    m.engineers = [engineer("a", 3, { expoPushToken: null }), engineer("b", 5, { phone: null }), engineer("c", 7, { email: null })];
    const sends = await runFollowUpLadder(NOW);
    expect(sends.map((s) => [s.engineerId, s.went])).toEqual([
      ["a", false],
      ["b", false],
      ["c", false],
    ]);
    expect(m.push).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled();
    expect(m.email).not.toHaveBeenCalled();
    expect(await runFollowUpLadder(NOW)).toEqual([]);
  });

  it("a send that throws is recorded as not sent and the run carries on", async () => {
    m.engineers = [engineer("a", 7), engineer("b", 3)];
    m.email.mockRejectedValueOnce(new Error("Resend down"));
    const sends = await runFollowUpLadder(NOW);
    expect(sends.map((s) => [s.engineerId, s.went])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
});
