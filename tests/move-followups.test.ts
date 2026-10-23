// Retention §4 — the moving-house follow-up: one new-owner lead per cancel
// request and one welcome letter per home, however often the daily job runs.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Ev = { id: string; name: string; meta: Record<string, unknown>; ts: Date };
const m = vi.hoisted(() => ({
  events: [] as { id: string; name: string; meta: Record<string, unknown>; ts: Date }[],
  requests: [] as unknown[],
  push: vi.fn(),
  notify: vi.fn(async () => undefined),
}));

function matches(e: Ev, where: { name: string; ts?: { gte: Date }; meta: { path: string[]; equals: unknown } }) {
  return (
    e.name === where.name &&
    (!where.ts || e.ts >= where.ts.gte) &&
    e.meta[where.meta.path[0]] === where.meta.equals
  );
}

vi.mock("@/lib/db", () => ({
  prisma: {
    cancelRequest: { findMany: vi.fn(async () => m.requests) },
    event: { findFirst: vi.fn(async ({ where }) => m.events.find((e) => matches(e, where)) ?? null) },
    homePassport: {
      findUnique: vi.fn(async ({ where }) => ({ id: where.id, addressLine1: "12 Oak Road", town: "Brighton", postcode: "BN1 1AA" })),
    },
    engineer: { findUnique: vi.fn(async () => ({ leftAt: null, deletedAt: null })) },
  },
}));
vi.mock("@/lib/track", () => ({
  track: vi.fn(async (name: string, _actor: unknown, meta: Record<string, unknown>) => {
    m.events.push({ id: `ev${m.events.length}`, name, meta, ts: new Date() });
  }),
}));
vi.mock("@/lib/sms", () => ({ notifyEngineer: m.notify }));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/passport", () => ({ passportForCustomer: vi.fn(async () => null) }));

import { letterAddress, moveFollowUps, newOwnerLeadText } from "@/lib/move-followups";

const now = new Date("2026-11-21T09:00:00Z");
const request = (id: string, passportId: string | null, engineerId = "eng1") => ({
  id,
  engineerId,
  moveDate: new Date("2026-11-14T00:00:00Z"),
  plan: { customerId: `cust-${id}`, passportId },
});

beforeEach(() => {
  m.events.length = 0;
  m.push.mockClear();
  m.notify.mockClear();
});

describe("moveFollowUps", () => {
  it("sends the lead and queues the letter once, however often it runs", async () => {
    m.requests = [request("cr1", "pp1")];
    expect(await moveFollowUps(now)).toEqual({ leads: 1, letters: 1 });
    expect(await moveFollowUps(now)).toEqual({ leads: 0, letters: 0 });
    expect(m.push).toHaveBeenCalledTimes(1);
    expect(m.notify).toHaveBeenCalledTimes(1);
    expect(m.notify).toHaveBeenCalledWith("eng1", expect.stringContaining("New owner moving into 12 Oak Road around 14 Nov"));
    const letters = m.events.filter((e) => e.name === "welcome_letter_queued");
    expect(letters).toHaveLength(1);
    expect(letters[0].meta).toMatchObject({ passportId: "pp1", engineerId: "eng1", letterFor: "new_owner" });
    expect(m.events.filter((e) => e.name === "new_owner_lead_sent")).toHaveLength(1);
  });

  it("two plans leaving one home: a lead each, one letter", async () => {
    m.requests = [request("cr1", "pp1", "eng1"), request("cr2", "pp1", "eng2")];
    expect(await moveFollowUps(now)).toEqual({ leads: 2, letters: 1 });
  });

  it("skips a move with no passport", async () => {
    m.requests = [request("cr3", null)];
    expect(await moveFollowUps(now)).toEqual({ leads: 0, letters: 0 });
    expect(m.events).toHaveLength(0);
  });
});

describe("letter copy", () => {
  it("addresses the homeowner", () => {
    expect(letterAddress({ addressLine1: "12 Oak Road", town: null, postcode: "BN1 1AA" })).toBe(
      "The Homeowner\n12 Oak Road\nBN1 1AA",
    );
    expect(newOwnerLeadText("12 Oak Road", new Date("2026-11-14T12:00:00Z"))).toContain("around 14 Nov");
  });
});
