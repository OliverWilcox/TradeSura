// Matt, 12 Nov — a Trustpilot invite to every customer after their first
// service and every engineer after their first Friday payout: once each,
// off until the review link is set, within the plan's monthly invites.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  services: 1,
  invitedBefore: false,
  sentThisMonth: 0,
  email: vi.fn(async () => {}),
  track: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    plan: { findMany: vi.fn(async () => [{ id: "p1" }]) },
    serviceRecord: { count: vi.fn(async () => m.services) },
    customer: { findUnique: vi.fn(async () => ({ email: "pat@example.com", firstName: "Pat" })) },
    engineer: { findUnique: vi.fn(async () => ({ email: "sam@example.com", firstName: "Sam" })) },
    event: { findFirst: vi.fn(async () => (m.invitedBefore ? { id: "ev" } : null)), count: vi.fn(async () => m.sentThisMonth) },
  },
}));
vi.mock("@/lib/email", () => ({ sendEmail: m.email }));
vi.mock("@/lib/track", () => ({ track: m.track }));

import { inviteCustomerAfterFirstService, inviteEngineerAfterFirstPayout } from "@/lib/trustpilot";

beforeEach(() => {
  vi.clearAllMocks();
  m.services = 1;
  m.invitedBefore = false;
  m.sentThisMonth = 0;
  vi.stubEnv("TRUSTPILOT_REVIEW_URL", "https://uk.trustpilot.com/evaluate/tradesura.com");
  vi.stubEnv("TRUSTPILOT_INVITE_BCC", "tradesura.com+abc@invite.trustpilot.com");
  vi.stubEnv("TRUSTPILOT_MONTHLY_LIMIT", "");
});

describe("Trustpilot invites", () => {
  it("invites a customer after their first service, copied to Trustpilot", async () => {
    expect(await inviteCustomerAfterFirstService("c1", "e1")).toBe(true);
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "pat@example.com", bcc: "tradesura.com+abc@invite.trustpilot.com", html: expect.stringContaining("trustpilot.com") }));
  });

  it("only after the first service, and only once", async () => {
    m.services = 2;
    expect(await inviteCustomerAfterFirstService("c1", "e1")).toBe(false);
    m.services = 1;
    m.invitedBefore = true;
    expect(await inviteCustomerAfterFirstService("c1", "e1")).toBe(false);
    expect(m.email).not.toHaveBeenCalled();
  });

  it("invites an engineer after their first payout", async () => {
    expect(await inviteEngineerAfterFirstPayout("e1")).toBe(true);
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: "sam@example.com" }));
  });

  it("stays within the free plan's 50 a month", async () => {
    m.sentThisMonth = 50;
    expect(await inviteEngineerAfterFirstPayout("e1")).toBe(false);
    expect(m.email).not.toHaveBeenCalled();
  });

  it("is off until the review link is set", async () => {
    vi.stubEnv("TRUSTPILOT_REVIEW_URL", "");
    expect(await inviteEngineerAfterFirstPayout("e1")).toBe(false);
    expect(await inviteCustomerAfterFirstService("c1", "e1")).toBe(false);
    expect(m.email).not.toHaveBeenCalled();
  });
});
