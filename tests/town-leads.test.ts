// 30 Oct update §10 — town page requests: Founding Members get first pick
// for the window, then everyone listed in the town; first claim wins.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  engineers: [] as { id: string }[],
  founding: new Set<string>(),
  created: null as Record<string, unknown> | null,
  lead: null as Record<string, unknown> | null,
  updateCount: 1,
  setting: null as string | null,
  notify: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  push: vi.fn(async () => undefined),
  sms: vi.fn(async () => ({ sent: true })),
  enquiry: vi.fn(async () => ({ id: "enq1" })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: {
      findMany: vi.fn(async () => m.engineers),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        m.engineers.some((e) => e.id === where.id)
          ? { id: where.id, townSlug: "holmfirth", tradingName: "Smith Heating", legalName: null, firstName: "Dave", lastName: "Smith", slug: "smith" }
          : null,
      ),
    },
    appSetting: { findUnique: vi.fn(async () => (m.setting ? { value: m.setting } : null)) },
    townLead: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (m.created = { id: "lead1", ...data })),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => m.lead),
      updateMany: vi.fn(async () => ({ count: m.updateCount })),
    },
    townPage: { findUnique: vi.fn(async () => null) },
    enquiry: { create: m.enquiry },
  },
}));
vi.mock("@/lib/founding", () => ({ foundingMemberIds: vi.fn(async () => m.founding) }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: m.notify, sendSms: m.sms }));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/track", () => ({ track: vi.fn(async () => undefined) }));

import {
  DEFAULT_FOUNDING_FIRST_MINUTES,
  LeadError,
  claimTownLead,
  createTownLead,
  foundingFirstMinutesFrom,
  leadOpenTo,
  leadTeaser,
} from "@/lib/town-leads";

const now = new Date("2026-11-02T10:00:00Z");
const mins = (n: number) => new Date(now.getTime() + n * 60_000);
const input = {
  townSlug: "holmfirth",
  townName: "Holmfirth",
  name: "Pat Hughes",
  phone: "+447700900123",
  email: null,
  postcode: "hd9 2ab",
  message: "Boiler service before winter please",
  emergency: null,
};

beforeEach(() => {
  m.engineers = [{ id: "f1" }, { id: "e2" }, { id: "e3" }];
  m.founding = new Set(["f1"]);
  m.created = null;
  m.lead = null;
  m.updateCount = 1;
  m.setting = null;
  m.notify.mockClear();
  m.push.mockClear();
  m.sms.mockClear();
  m.enquiry.mockClear();
});

describe("who can see a request", () => {
  const lead = { claimedById: null, openedAt: null, foundingUntil: mins(120), createdAt: now };

  it("Founding Members at once, everyone else only after the window", () => {
    expect(leadOpenTo(lead, { founding: true }, mins(1))).toBe(true);
    expect(leadOpenTo(lead, { founding: false }, mins(119))).toBe(false);
    expect(leadOpenTo(lead, { founding: false }, mins(120))).toBe(true);
  });

  it("opens by the clock even before the job has run", () => {
    expect(leadOpenTo({ ...lead, openedAt: null }, { founding: false }, mins(180))).toBe(true);
  });

  it("nobody once it's claimed, and not after 14 days", () => {
    expect(leadOpenTo({ ...lead, claimedById: "f1" }, { founding: true }, mins(1))).toBe(false);
    expect(leadOpenTo(lead, { founding: true }, mins(15 * 24 * 60))).toBe(false);
  });

  it("shows only a first name and postcode district before it's claimed", () => {
    expect(leadTeaser({ name: "Pat Hughes", postcode: "HD9 2AB" })).toBe("Pat in HD9");
  });

  it("reads the admin window, falling back to 2 hours", () => {
    expect(foundingFirstMinutesFrom("90")).toBe(90);
    expect(foundingFirstMinutesFrom("nonsense")).toBe(DEFAULT_FOUNDING_FIRST_MINUTES);
    expect(foundingFirstMinutesFrom(undefined)).toBe(120);
  });
});

describe("a new request", () => {
  it("goes to the town's Founding Members first, for the window", async () => {
    await createTownLead(input, now);
    expect(m.created?.openedAt).toBeNull();
    expect(m.created?.foundingUntil).toEqual(mins(120));
    expect(m.notify.mock.calls.map((c) => c[0])).toEqual(["f1"]);
    expect(m.notify.mock.calls[0][2]).toEqual({ template: "town_lead_founding", vars: ["Holmfirth", "Pat in HD9", "2 hours"] });
  });

  it("opens to everyone at once when the town has no Founding Members", async () => {
    m.founding = new Set();
    await createTownLead(input, now);
    expect(m.created?.openedAt).toEqual(now);
    expect(m.notify.mock.calls.map((c) => c[0])).toEqual(["f1", "e2", "e3"]);
    expect(m.notify.mock.calls[0][2]).toMatchObject({ template: "town_lead_open" });
  });

  it("uses the admin's window", async () => {
    m.setting = "30";
    await createTownLead(input, now);
    expect(m.created?.foundingUntil).toEqual(mins(30));
  });
});

describe("taking a request", () => {
  const open = { ...input, id: "lead1", townSlug: "holmfirth", claimedById: null, foundingUntil: mins(120), createdAt: now, postcode: "HD9 2AB" };

  it("a Founding Member can take it during the window and gets the details as an enquiry", async () => {
    m.lead = { ...open, openedAt: null };
    const got = await claimTownLead("f1", "lead1", mins(10));
    expect(got.phone).toBe("+447700900123");
    expect(m.enquiry).toHaveBeenCalledWith({
      data: expect.objectContaining({ engineerId: "f1", source: "town", name: "Pat Hughes" }),
    });
    expect(m.sms).toHaveBeenCalledWith(expect.objectContaining({ to: "+447700900123", messageClass: "TRANSACTIONAL" }));
  });

  it("anyone else has to wait for the window", async () => {
    m.lead = { ...open, openedAt: null };
    await expect(claimTownLead("e2", "lead1", mins(10))).rejects.toMatchObject({ status: 409 });
  });

  it("the second engineer to tap loses the race", async () => {
    m.lead = { ...open, openedAt: mins(120) };
    m.updateCount = 0;
    const err = await claimTownLead("e2", "lead1", mins(130)).catch((e) => e);
    expect(err).toBeInstanceOf(LeadError);
    expect(err.message).toMatch(/already taken/);
    expect(m.enquiry).not.toHaveBeenCalled();
  });

  it("an engineer from another town can't take it", async () => {
    m.lead = { ...open, townSlug: "huddersfield", openedAt: mins(0) };
    await expect(claimTownLead("e2", "lead1", mins(130))).rejects.toMatchObject({ status: 404 });
  });
});
