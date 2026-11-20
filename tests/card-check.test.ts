// Matt: AI reads the Gas Safe card; a clear match makes the engineer live
// straight away, anything else stays in the admin's card queue.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  engineer: null as Record<string, unknown> | null,
  updateMany: vi.fn(async () => ({ count: 1 })),
  track: vi.fn(),
  push: vi.fn(async () => {}),
  notify: vi.fn(async () => true),
  verifiedEmail: vi.fn(async () => true),
}));

vi.mock("@/lib/db", () => ({
  prisma: { engineer: { findUnique: vi.fn(async () => m.engineer), updateMany: m.updateMany } },
}));
vi.mock("@/lib/track", () => ({ track: m.track }));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: m.notify }));
vi.mock("@/lib/verified-email", () => ({ sendVerifiedEmail: m.verifiedEmail }));

import { autoCheckCard, cardProblem, judgeCard, type CardReading } from "@/lib/card-check";

const card: CardReading = {
  isGasSafeIdCard: true,
  readable: true,
  isPhotoOfScreen: false,
  holderName: "SAMUEL J. HARGREAVES",
  licenceNumber: "7654321",
  registrationNumber: "612345",
  businessName: "Hargreaves Heating Ltd",
  expiresOn: "2027-08-31",
  categories: ["Domestic boilers"],
};
const sam = { gasSafeNo: "7654321", firstName: "Sam", lastName: "Hargreaves" };
const today = new Date("2026-11-13T12:00:00Z");

describe("judging a card reading", () => {
  it("passes the right engineer by licence or business registration number", () => {
    expect(judgeCard(card, sam, today)).toEqual({ pass: true });
    expect(judgeCard(card, { ...sam, gasSafeNo: "612 345" }, today)).toEqual({ pass: true });
  });

  it("leaves anything that doesn't clearly match for the admin", () => {
    expect(judgeCard(card, { ...sam, gasSafeNo: "1111111" }, today)).toMatchObject({ pass: false, reasons: ["number_mismatch"] });
    expect(judgeCard(card, { ...sam, firstName: "Tom", lastName: "Smith" }, today)).toMatchObject({ pass: false, reasons: ["name_mismatch"] });
    expect(judgeCard(card, { ...sam, firstName: "Tom" }, today)).toMatchObject({ pass: false, reasons: ["name_mismatch"] });
    expect(judgeCard({ ...card, expiresOn: "2026-10-31" }, sam, today)).toMatchObject({ pass: false, reasons: ["expired"] });
    expect(judgeCard({ ...card, expiresOn: null }, sam, today)).toMatchObject({ pass: false, reasons: ["no_expiry"] });
    expect(judgeCard({ ...card, isGasSafeIdCard: false }, sam, today)).toMatchObject({ pass: false });
    expect(judgeCard({ ...card, readable: false }, sam, today)).toMatchObject({ pass: false });
    expect(judgeCard({ ...card, isPhotoOfScreen: true }, sam, today)).toMatchObject({ pass: false, reasons: ["screen_photo"] });
  });
});

describe("the check at upload (sign-up step 2)", () => {
  it("asks for another photo of anything that isn't a clear, current, physical card", () => {
    expect(cardProblem(card, today)).toBeNull();
    expect(cardProblem({ ...card, isGasSafeIdCard: false }, today)).toBe("not_a_card");
    expect(cardProblem({ ...card, isPhotoOfScreen: true }, today)).toBe("screen_photo");
    expect(cardProblem({ ...card, readable: false }, today)).toBe("not_readable");
    expect(cardProblem({ ...card, expiresOn: "2026-10-31" }, today)).toBe("expired");
    // An unread expiry isn't a reason to retake; the admin sees it.
    expect(cardProblem({ ...card, expiresOn: null }, today)).toBeNull();
  });
});

describe("the automatic check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    m.engineer = { ...sam, gasSafeVerifiedAt: null, gasSafeRejectedAt: null, bannedAt: null, gasSafeCardExpiresOn: null, gasSafeCategories: null, gasSafeRegistrationNo: null };
  });

  const answer = (reading: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reading) } }] }), { status: 200 })));

  it("a clear pass makes them live, with the register check still to come, and tells them", async () => {
    answer(card);
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" })).toBe("passed");
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: "e1", gasSafeVerifiedAt: null, bannedAt: null },
      data: expect.objectContaining({ gasSafeVerifiedAt: expect.any(Date), gasSafeRegisterCheckedAt: null, gasSafeRegistrationNo: "612345", gasSafeCategories: "Domestic boilers" }),
    });
    expect(m.push).toHaveBeenCalled();
    expect(m.verifiedEmail).toHaveBeenCalledWith("e1");
  });

  it("anything else is left for the admin, untouched", async () => {
    answer({ ...card, licenceNumber: "1111111", registrationNumber: null });
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" })).toBe("left_for_admin");
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.push).not.toHaveBeenCalled();
  });

  it("a gateway failure is left for the admin and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" })).toBe("left_for_admin");
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  // Matt 16 Nov — the back of the card, read alongside the front.
  const answers = (...readings: unknown[]) => {
    const f = vi.fn();
    for (const r of readings) f.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(r) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);
  };

  it("takes the work categories from the back when the front has none", async () => {
    answers({ ...card, categories: [] }, { ...card, licenceNumber: null, holderName: null, categories: ["Gas fires", "Cookers"] });
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" }, { base64: "y", mimeType: "image/jpeg" })).toBe("passed");
    expect(m.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ gasSafeCategories: "Gas fires, Cookers" }) }));
  });

  it("a back that's a photo of a screen, or not the card, goes to the admin", async () => {
    answers(card, { ...card, isPhotoOfScreen: true });
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" }, { base64: "y", mimeType: "image/jpeg" })).toBe("left_for_admin");
    answers(card, { ...card, isGasSafeIdCard: false });
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" }, { base64: "y", mimeType: "image/jpeg" })).toBe("left_for_admin");
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("a front that's a photo of a screen is never passed", async () => {
    answer({ ...card, isPhotoOfScreen: true });
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" })).toBe("left_for_admin");
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("does nothing without the gateway set up", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    expect(await autoCheckCard("e1", { base64: "x", mimeType: "image/jpeg" })).toBe("skipped");
  });
});
