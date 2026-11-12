// Muhammad's app-side notes (3 Nov): a WhatsApp offer that never left the
// phone is recorded as offer_failed, and the Account switch changes only the
// setup-texts consent.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  actor: { actorId: "e1", businessId: "e1", role: "owner" } as null | Record<string, string>,
  plan: { id: "p1", customerId: "c1" } as null | { id: string; customerId: string },
  planFind: vi.fn(),
  engineerUpdate: vi.fn(async () => ({})),
  track: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    plan: { findFirst: m.planFind },
    engineer: { update: m.engineerUpdate, findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({
  getActor: vi.fn(async () => m.actor),
  getEngineerId: vi.fn(async () => m.actor?.businessId ?? null),
}));
vi.mock("@/lib/track", () => ({ track: m.track }));

import { POST as offerFailed } from "@/app/api/offer/[planId]/failed/route";
import { PATCH as patchSettings } from "@/app/api/settings/route";

const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const params = { params: Promise.resolve({ planId: "p1" }) };

beforeEach(() => {
  m.actor = { actorId: "e1", businessId: "e1", role: "owner" };
  m.planFind.mockReset().mockImplementation(async () => m.plan);
  m.engineerUpdate.mockClear();
  m.track.mockClear();
});

describe("offer_failed when WhatsApp didn't open", () => {
  it("records it against the plan, with the channel", async () => {
    const res = await offerFailed(post({ channel: "whatsapp" }), params);
    expect(res.status).toBe(200);
    expect(m.track).toHaveBeenCalledWith("offer_failed", { type: "ENGINEER", id: "e1" }, expect.objectContaining({ planId: "p1", customerId: "c1", channel: "whatsapp" }));
  });

  it("a staff member can only report their own offers", async () => {
    m.actor = { actorId: "s1", businessId: "e1", role: "staff" };
    await offerFailed(post({ channel: "whatsapp" }), params);
    expect(m.planFind.mock.calls[0][0].where).toMatchObject({ id: "p1", engineerId: "e1", soldById: "s1" });
  });

  it("someone else's plan is not found, and nothing is recorded", async () => {
    m.plan = null;
    expect((await offerFailed(post({ channel: "whatsapp" }), params)).status).toBe(404);
    expect(m.track).not.toHaveBeenCalled();
    m.plan = { id: "p1", customerId: "c1" };
  });

  it("only WhatsApp: a text's delivery comes from Twilio", async () => {
    expect((await offerFailed(post({ channel: "sms" }), params)).status).toBe(400);
  });
});

describe("setup-texts switch", () => {
  it("changes only the consent: name, logo and address stay as they are", async () => {
    const res = await patchSettings(new Request("http://x", { method: "PATCH", body: JSON.stringify({ setupTextConsent: true }) }));
    expect(res.status).toBe(200);
    expect(m.engineerUpdate).toHaveBeenCalledTimes(1);
    const data = (m.engineerUpdate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(Object.keys(data)).toEqual(["setupTextConsentAt"]);
    expect(data.setupTextConsentAt).toBeInstanceOf(Date);
    // The change of mind goes on the Activity tab (Matt, 4 Nov).
    expect(m.track).toHaveBeenCalledWith("setup_texts_opted_in", { type: "ENGINEER", id: "e1" }, { via: "account" });
  });

  it("turning it off clears it; the same answer again records nothing", async () => {
    await patchSettings(new Request("http://x", { method: "PATCH", body: JSON.stringify({ setupTextConsent: false }) }));
    expect((m.engineerUpdate.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data).toEqual({ setupTextConsentAt: null });
    expect(m.track).not.toHaveBeenCalled();
  });
});
