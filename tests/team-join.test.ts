// 30 Oct update 3.9 — a second person from a firm joins as staff, not as a
// second account: recognising the firm, and the request reaching its owner.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  claimFind: vi.fn(),
  engFindFirst: vi.fn(),
  engFindUnique: vi.fn(),
  eventCreate: vi.fn(),
  eventFind: vi.fn(),
  push: vi.fn(),
  email: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    claimCode: { findFirst: m.claimFind },
    engineer: { findFirst: m.engFindFirst, findUnique: m.engFindUnique },
    event: { create: m.eventCreate, findUnique: m.eventFind },
  },
}));
vi.mock("@/lib/push", () => ({ sendPushNotification: m.push }));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));
vi.mock("@/lib/track", () => ({ track: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({ verifyToken: m.verify, getEngineerId: vi.fn() }));

import { findFirm, joinRequestFor, requestToJoin } from "@/lib/team-join";
import { POST as joinTeam } from "@/app/api/onboarding/join-team/route";

const owner = { id: "own-1", tradingName: "MW Heating", legalName: null, slug: "mw-heating", firstName: "Matt" };

beforeEach(() => {
  vi.resetAllMocks();
  m.push.mockResolvedValue(undefined);
  m.email.mockResolvedValue(undefined);
  m.eventCreate.mockResolvedValue({ id: "req-1" });
  m.engFindUnique.mockResolvedValue({ email: "matt@example.com" });
});

describe("findFirm", () => {
  it("finds the owner from a letter code that's already been claimed", async () => {
    m.claimFind.mockResolvedValue({ redeemedByEngineerId: "own-1" });
    m.engFindFirst.mockResolvedValue(owner);
    expect(await findFirm({ claimCode: "ts 48217" })).toEqual({ ownerId: "own-1", businessName: "MW Heating", ownerFirstName: "Matt" });
    expect(m.claimFind).toHaveBeenCalledWith(expect.objectContaining({ where: { code: { in: ["TS-48217"] } } }));
  });

  it("finds the owner by company number, never a staff row", async () => {
    m.engFindFirst.mockResolvedValue(owner);
    await findFirm({ companyNumber: "1234567" });
    expect(m.engFindFirst.mock.calls[0][0].where).toMatchObject({ companyNumber: "01234567", ownerId: null, deletedAt: null });
  });

  it("an unclaimed code and no company number is a new firm", async () => {
    m.claimFind.mockResolvedValue({ redeemedByEngineerId: null });
    expect(await findFirm({ claimCode: "TS-48217" })).toBeNull();
    expect(m.engFindFirst).not.toHaveBeenCalled();
  });
});

describe("join requests", () => {
  const firm = { ownerId: "own-1", businessName: "MW Heating", ownerFirstName: "Matt" };
  const who = { firstName: "Sam", lastName: "Lee", email: "sam@example.com", phone: "+447700900456" };

  it("tells the owner by push, deep-linking to a pre-filled Add an engineer", async () => {
    expect(await requestToJoin(firm, who)).toBe("req-1");
    expect(m.push).toHaveBeenCalledWith("own-1", "Sam Lee wants to join your team", expect.any(String), { url: "/team-add?request=req-1" });
    expect(m.email.mock.calls[0][0]).toMatchObject({ to: "matt@example.com", subject: "Sam Lee wants to join MW Heating on TradeSura" });
  });

  it("only the firm's owner can read a request", async () => {
    m.eventFind.mockResolvedValue({ name: "team_join_requested", meta: { ownerId: "own-1", ...who } });
    expect(await joinRequestFor("own-1", "req-1")).toMatchObject({ firstName: "Sam", email: "sam@example.com" });
    expect(await joinRequestFor("someone-else", "req-1")).toBeNull();
  });

  it("passes on only verified contact details", async () => {
    m.verify.mockImplementation(async (t: string) =>
      t === "phone" ? { verified: "1", phone: "+447700900456" } : { emailVerified: "1", email: "sam@example.com" },
    );
    m.claimFind.mockResolvedValue({ redeemedByEngineerId: "own-1" });
    m.engFindFirst.mockResolvedValue(owner);
    const res = await joinTeam(
      new Request("http://localhost/api/onboarding/join-team", {
        method: "POST",
        body: JSON.stringify({ phoneToken: "phone", emailToken: "email", firstName: "Sam", lastName: "Lee", claimCode: "TS-48217" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(m.eventCreate.mock.calls[0][0].data.meta).toMatchObject({ email: "sam@example.com", phone: "+447700900456" });
  });

  it("refuses an expired verification", async () => {
    m.verify.mockResolvedValue(null);
    const res = await joinTeam(
      new Request("http://localhost/api/onboarding/join-team", {
        method: "POST",
        body: JSON.stringify({ phoneToken: "x", emailToken: "y", firstName: "Sam", lastName: "Lee", claimCode: "TS-48217" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(m.eventCreate).not.toHaveBeenCalled();
  });
});
