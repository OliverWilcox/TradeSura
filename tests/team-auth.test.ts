import { beforeEach, describe, expect, it, vi } from "vitest";

// Build Review 2, section 8 — staff act inside their owner's business, lose
// access the moment they're removed, and never reach owner-only routes.
const m = vi.hoisted(() => {
  // lib/auth reads the secret at import time, so set it before imports run.
  process.env.SESSION_SECRET = "test-secret-for-team-auth";
  return { auth: "", findUnique: vi.fn() };
});
vi.mock("next/headers", () => ({ headers: async () => new Map([["authorization", m.auth]]) }));
vi.mock("@/lib/db", () => ({ prisma: { engineer: { findUnique: m.findUnique } } }));
import { getActor, getEngineerId, signToken } from "@/lib/auth";

async function as(payload: Record<string, string>) {
  m.auth = `Bearer ${await signToken(payload, "1h")}`;
}
const row = (over: Record<string, unknown> = {}) => ({
  ownerId: null,
  staffRemovedAt: null,
  deletedAt: null,
  owner: null,
  ...over,
});

beforeEach(() => m.findUnique.mockReset());

describe("team access", () => {
  it("an owner acts on their own business", async () => {
    await as({ engineerId: "owner1" });
    m.findUnique.mockResolvedValue(row());
    expect(await getActor()).toEqual({ actorId: "owner1", businessId: "owner1", role: "owner" });
    expect(await getEngineerId()).toBe("owner1");
  });

  it("staff act inside the owner's business but are shut out of owner-only routes", async () => {
    await as({ engineerId: "staff1", biz: "owner1" });
    m.findUnique.mockResolvedValue(row({ ownerId: "owner1", owner: { deletedAt: null } }));
    expect(await getActor()).toEqual({ actorId: "staff1", businessId: "owner1", role: "staff" });
    expect(await getEngineerId()).toBeNull();
  });

  it("removing staff cuts access on the next request", async () => {
    await as({ engineerId: "staff1", biz: "owner1" });
    m.findUnique.mockResolvedValue(row({ ownerId: "owner1", staffRemovedAt: new Date(), owner: { deletedAt: null } }));
    expect(await getActor()).toBeNull();
  });

  it("a staff token for a different business is refused", async () => {
    await as({ engineerId: "staff1", biz: "ownerX" });
    m.findUnique.mockResolvedValue(row({ ownerId: "owner1", owner: { deletedAt: null } }));
    expect(await getActor()).toBeNull();
  });

  it("deleted accounts — or a deleted owner — sign everyone out", async () => {
    await as({ engineerId: "owner1" });
    m.findUnique.mockResolvedValue(row({ deletedAt: new Date() }));
    expect(await getActor()).toBeNull();
    await as({ engineerId: "staff1", biz: "owner1" });
    m.findUnique.mockResolvedValue(row({ ownerId: "owner1", owner: { deletedAt: new Date() } }));
    expect(await getActor()).toBeNull();
  });
});
