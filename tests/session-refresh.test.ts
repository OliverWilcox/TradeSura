// 30 Oct update 3.5 — "Stay logged in": the app swaps its session for a fresh
// one while it's in use; only a live account gets one.
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ actor: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getActor: m.actor }));
vi.mock("@/lib/sign-in-code", () => ({ sessionToken: m.session }));
import { POST } from "@/app/api/auth/refresh/route";

beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockImplementation(async (id: string) => `fresh-${id}`);
});

it("renews the signed-in person's session", async () => {
  m.actor.mockResolvedValue({ actorId: "staff-1", businessId: "owner-1", role: "staff" });
  const res = await POST();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ token: "fresh-staff-1" });
});

it("refuses a deleted account or removed staff (no actor)", async () => {
  m.actor.mockResolvedValue(null);
  const res = await POST();
  expect(res.status).toBe(401);
  expect(m.session).not.toHaveBeenCalled();
});
