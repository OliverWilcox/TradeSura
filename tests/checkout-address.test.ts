import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ plan: { findUnique: vi.fn() }, property: { findFirst: vi.fn(), create: vi.fn() }, $queryRaw: vi.fn(), getEngineerId: vi.fn(), getActor: vi.fn(), verifyToken: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { ...m, $transaction: (fn: (tx: typeof m) => unknown) => fn(m) } }));
vi.mock("@/lib/auth", () => ({ getEngineerId: m.getEngineerId, getActor: m.getActor, verifyToken: m.verifyToken }));
import { POST as lookup } from "@/app/api/address/lookup/route";
import { POST as save } from "@/app/api/signup/[token]/address/route";
const body = { line1: "10 Test Road", town: "Brighton", postcode: "bn11aa" };
function request(data: unknown) { return new Request("http://localhost", { method: "POST", body: JSON.stringify(data) }); }
beforeEach(() => { vi.resetAllMocks(); m.$queryRaw.mockResolvedValue([{ customerId: "customer-test" }]); m.property.findFirst.mockResolvedValue(null); });
it("rejects lookup without a valid signup link or engineer session", async () => {
  m.plan.findUnique.mockResolvedValue(null);
  expect((await lookup(request({ postcode: "BN1 1AA", signupToken: "bad" }))).status).toBe(401);
});
it("rejects address writes for completed or unknown links", async () => {
  m.$queryRaw.mockResolvedValue([]);
  expect((await save(request(body), { params: Promise.resolve({ token: "expired" }) })).status).toBe(409);
  expect(m.property.create).not.toHaveBeenCalled();
});
it("saves a validated address against the token's customer", async () => {
  expect((await save(request(body), { params: Promise.resolve({ token: "pending" }) })).status).toBe(200);
  expect(m.property.create).toHaveBeenCalledWith({ data: { customerId: "customer-test", addressLine1: "10 Test Road", town: "Brighton", postcode: "BN1 1AA" } });
});
it("does not create the same property on a retry", async () => {
  m.property.findFirst.mockResolvedValue({ id: "existing" });
  expect((await save(request(body), { params: Promise.resolve({ token: "pending" }) })).status).toBe(200);
  expect(m.property.create).not.toHaveBeenCalled();
});
it("rejects incomplete manual addresses", async () => {
  expect((await save(request({ ...body, town: "" }), { params: Promise.resolve({ token: "pending" }) })).status).toBe(400);
  expect(m.$queryRaw).not.toHaveBeenCalled();
});
