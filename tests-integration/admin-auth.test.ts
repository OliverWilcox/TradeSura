import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GET as me } from "@/app/api/admin/v1/me/route";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { signToken } from "@/lib/auth";
import { CHECKER, call, SUPER_ADMIN, tokenFor, withPermissions } from "./helpers";

// Who may call the admin API: only the admin app, with a short-lived token
// signed with ADMIN_API_SECRET, carrying permissions the route checks.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin API tokens", () => {
  it("are required", async () => {
    const res = await call(me, { token: null });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("identify the admin and what they may do", async () => {
    const res = await call(me, { as: CHECKER, headers: { "x-request-id": "req-123" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: CHECKER.id, name: CHECKER.name, role: CHECKER.role, permissions: CHECKER.permissions });
    expect(res.headers.get("x-request-id")).toBe("req-123");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("must be signed with the admin API secret", async () => {
    const res = await call(me, { token: await tokenFor(SUPER_ADMIN, { secret: "some-other-secret-some-other-secret-0000" }) });
    expect(res.status).toBe(401);
  });

  it("are refused once expired", async () => {
    const res = await call(me, { token: await tokenFor(SUPER_ADMIN, { seconds: -30 }) });
    expect(res.status).toBe(401);
  });

  it("can't be made to last longer than two minutes", async () => {
    const res = await call(me, { token: await tokenFor(SUPER_ADMIN, { seconds: 600 }) });
    expect(res.status).toBe(401);
  });

  it("aren't the engineers' app tokens", async () => {
    const engineerToken = await signToken({ engineerId: "eng_1" }, "1h");
    expect((await call(me, { token: engineerToken })).status).toBe(401);
  });

  it("can only carry known permissions", async () => {
    const forged = { ...SUPER_ADMIN, permissions: ["everything:all"] } as unknown as typeof SUPER_ADMIN;
    expect((await call(me, { token: await tokenFor(forged) })).status).toBe(401);
  });

  it("aren't accepted when the admin API isn't set up", async () => {
    const token = await tokenFor();
    vi.stubEnv("ADMIN_API_SECRET", "");
    const res = await call(me, { token });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("NOT_CONFIGURED");
  });

  it("aren't accepted when the admin secret is the engineers' session secret", async () => {
    vi.stubEnv("ADMIN_API_SECRET", process.env.SESSION_SECRET!);
    const token = await tokenFor();
    expect((await call(me, { token })).status).toBe(503);
  });

  it("can be signed with the next secret while the admin app moves to it", async () => {
    const next = "the-next-admin-api-secret-the-next-admin-api";
    const signedWithNext = await tokenFor(SUPER_ADMIN, { secret: next });
    expect((await call(me, { token: signedWithNext })).status).toBe(401);
    vi.stubEnv("ADMIN_API_SECRET_NEXT", next);
    expect((await call(me, { token: signedWithNext })).status).toBe(200);
    expect((await call(me, { token: await tokenFor() })).status).toBe(200);
  });
});

describe("admin API routes", () => {
  const guarded = adminRoute("engineers:ban", async () => ({ done: true }));
  const echo = adminRoute(null, async ({ req }) => parseBody(req, z.strictObject({ reason: z.string().min(3) })));
  const broken = adminRoute(null, async () => {
    throw new Error("database password is hunter2");
  });

  it("check the permission each one needs", async () => {
    const res = await call(guarded, { as: withPermissions("engineers:read") });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect((await call(guarded, { as: withPermissions("engineers:ban") })).body).toEqual({ done: true });
  });

  it("validate bodies and say which field is wrong", async () => {
    const res = await call(echo, { body: { reason: "no" } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION");
    expect(res.body.error.fields.reason).toHaveLength(1);
  });

  it("refuse unknown fields", async () => {
    const res = await call(echo, { body: { reason: "fine", extra: true } });
    expect(res.status).toBe(400);
  });

  it("only take JSON", async () => {
    const res = await call(echo, { body: "reason=hello", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.status).toBe(415);
  });

  it("never leak internal errors", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(broken);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
