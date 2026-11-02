// 30 Oct update §6.4 — "Before I go, would you leave me a quick review?":
// every customer, joined or not; no review without a verified mobile or email.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  plan: null as null | Record<string, unknown>,
  existingReview: null as null | { id: string },
  ratingCreate: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "r1", ...data })),
  customerUpsert: vi.fn(async () => ({ id: "c9" })),
  sendSms: vi.fn(async () => ({ sent: false })),
  push: vi.fn(),
  lowAlert: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    offerSession: { findUnique: vi.fn(async () => m.session) },
    plan: { findUnique: vi.fn(async () => m.plan) },
    rating: { findUnique: vi.fn(async () => m.existingReview), create: m.ratingCreate },
    customer: { upsert: m.customerUpsert },
    engineer: { findUniqueOrThrow: vi.fn(async () => ({ id: "e1", slug: "smith", tradingName: "Smith Heating" })) },
    visitReasonContent: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/sms", () => ({ sendSms: m.sendSms }));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/track", () => ({ track: m.track }));
vi.mock("@/lib/ratings", async (orig) => ({ ...(await orig<typeof import("@/lib/ratings")>()), alertLowRating: m.lowAlert }));

import { followUpTimes, submitOfferReview } from "@/lib/offer-session";

const SESSION = { id: "s1", token: "tok", engineerId: "e1", soldById: null, reason: "new_boiler", variant: "A", planId: null };

beforeEach(() => {
  m.session = { ...SESSION };
  m.plan = null;
  m.existingReview = null;
  for (const f of [m.ratingCreate, m.customerUpsert, m.sendSms, m.push, m.lowAlert]) f.mockClear();
});

describe("at-the-job review", () => {
  it("a joiner's details carry over: no code needed", async () => {
    m.session = { ...SESSION, planId: "p1" };
    m.plan = { id: "p1", customerId: "c1", customer: { firstName: "Pat", lastName: "Hughes", phone: "+447700900123", email: null } };
    expect(await submitOfferReview("tok", "e1", { stars: 5, consent: true })).toEqual({ ok: true, low: false });
    const data = m.ratingCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ planId: "p1", source: "offer", customerName: "Pat H.", contactPhone: "+447700900123" });
    expect(m.sendSms).not.toHaveBeenCalled(); // already on a plan: no plan offers
  });

  it("no review without a mobile or email", async () => {
    const r = await submitOfferReview("tok", "e1", { stars: 5, name: "Sam Lee", consent: true });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(m.ratingCreate).not.toHaveBeenCalled();
  });

  it("a contact only counts once the customer proved it with a code", async () => {
    const r = await submitOfferReview("tok", "e1", { stars: 4, name: "Sam Lee", phone: "07700 900456", consent: true });
    expect(r).toMatchObject({ ok: false, status: 400, error: "Enter the code we sent you first." });
  });

  it("a verified non-joiner who ticked plan offers goes in the book and gets the 2- and 7-day texts", async () => {
    const r = await submitOfferReview("tok", "e1", {
      stars: 5,
      name: "Sam Lee",
      phone: "07700 900456",
      verifiedPhone: "+447700900456",
      consent: true,
    });
    expect(r).toEqual({ ok: true, low: false });
    expect(m.ratingCreate.mock.calls[0][0].data).toMatchObject({ planId: null, offerConsent: true, customerName: "Sam L." });
    expect(m.customerUpsert).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledTimes(2);
    expect(m.sendSms.mock.calls.every((c) => (c as unknown as [{ messageClass: string }])[0].messageClass === "MARKETING")).toBe(true);
  });

  it("unticked: the review is saved, but no plan offers follow", async () => {
    await submitOfferReview("tok", "e1", { stars: 5, name: "Sam", email: "sam@example.com", verifiedEmail: "sam@example.com", consent: false });
    expect(m.ratingCreate).toHaveBeenCalledTimes(1);
    expect(m.customerUpsert).not.toHaveBeenCalled();
    expect(m.sendSms).not.toHaveBeenCalled();
  });

  it("runs the gas-emergency interlock on the comment first", async () => {
    m.session = { ...SESSION, planId: "p1" };
    m.plan = { id: "p1", customerId: "c1", customer: { firstName: "Pat", lastName: "Hughes", phone: "+447700900123", email: null } };
    const r = await submitOfferReview("tok", "e1", { stars: 3, comment: "I can smell gas in the kitchen", consent: true });
    expect(r).toMatchObject({ ok: false, status: 409, emergency: true });
    expect(m.ratingCreate).not.toHaveBeenCalled();
    const ok = await submitOfferReview("tok", "e1", { stars: 3, comment: "I can smell gas in the kitchen", acknowledged: true, consent: true });
    expect(ok.ok).toBe(true);
  });

  it("one review per offer, and only for this business's offer", async () => {
    m.existingReview = { id: "r0" };
    expect(await submitOfferReview("tok", "e1", { stars: 5, consent: true })).toMatchObject({ ok: false, status: 409 });
    m.existingReview = null;
    expect(await submitOfferReview("tok", "someone-else", { stars: 5, consent: true })).toMatchObject({ ok: false, status: 404 });
  });

  it("a low review alerts the installer", async () => {
    m.session = { ...SESSION, planId: "p1" };
    m.plan = { id: "p1", customerId: "c1", customer: { firstName: "Pat", lastName: "Hughes", phone: "+447700900123", email: null } };
    await submitOfferReview("tok", "e1", { stars: 2, consent: true });
    expect(m.lowAlert).toHaveBeenCalledWith("r1");
  });
});

describe("follow-ups", () => {
  it("go at 2 and 7 days, mid-morning", () => {
    const [d2, d7] = followUpTimes(new Date(2026, 10, 2, 15, 30));
    expect([d2.getDate(), d2.getHours()]).toEqual([4, 10]);
    expect([d7.getDate(), d7.getHours()]).toEqual([9, 10]);
  });
});
