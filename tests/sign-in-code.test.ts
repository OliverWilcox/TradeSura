import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), create: vi.fn(), delete: vi.fn(), findUnique: vi.fn(),
  update: vi.fn(), updateMany: vi.fn(), sendEmail: vi.fn(),
  signToken: vi.fn(), verifyToken: vi.fn(), emailConfigured: vi.fn(), engineerFindUnique: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { signInCode: mocks, engineer: { findUnique: mocks.engineerFindUnique } } }));
vi.mock("@/lib/email", () => ({ emailConfigured: mocks.emailConfigured, sendEmail: mocks.sendEmail }));
vi.mock("@/lib/auth", () => ({ signToken: mocks.signToken, verifyToken: mocks.verifyToken }));
import { hashCode, issueSignInCode, signInCodesEnabled } from "@/lib/sign-in-code";
import { POST } from "@/app/api/auth/verify/route";

function verify(code: string) {
  return POST(new Request("http://localhost/api/auth/verify", {
    method: "POST", body: JSON.stringify({ requestToken: "test-request", code }),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.emailConfigured.mockReturnValue(true);
  mocks.update.mockResolvedValue({ attempts: 1 });
  mocks.findFirst.mockResolvedValue(null);
  mocks.create.mockResolvedValue({ id: "test-code" });
  mocks.signToken.mockResolvedValue("test-session");
  mocks.verifyToken.mockResolvedValue({ signInCodeId: "test-code" });
  mocks.findUnique.mockResolvedValue({
    id: "test-code", engineerId: "test-engineer", codeHash: hashCode("1234"),
    expiresAt: new Date(Date.now() + 600_000), usedAt: null, attempts: 0,
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => vi.unstubAllEnvs());

describe("four-digit email sign-in", () => {
  it("emails four digits, stores only their hash and does not return the code", async () => {
    const result = await issueSignInCode({ id: "test-engineer", email: "test@example.com" });
    const email = mocks.sendEmail.mock.calls[0][0];
    const code = email.subject.split(" ")[0];
    expect(code).toMatch(/^\d{4}$/);
    expect(email.html).toContain(code);
    expect(mocks.create.mock.calls[0][0].data.codeHash).toBe(hashCode(code));
    expect(result).not.toHaveProperty("devCode");
  });
  it.each(["123", "12345", "123456", "abcd"])("rejects invalid format %s before querying a code", async (code) => {
    expect((await verify(code)).status).toBe(400);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it("accepts a matching four-digit code", async () => {
    expect(await (await verify("1234")).json()).toEqual({ token: "test-session" });
  });
  it("rejects a code already consumed by another request", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await verify("1234")).status).toBe(400);
    expect(mocks.signToken).not.toHaveBeenCalled();
  });
  it("locks for fifteen minutes on the fifth wrong code", async () => {
    const row = await mocks.findUnique();
    mocks.findUnique.mockResolvedValue({ ...row, attempts: 4 });
    mocks.update.mockResolvedValue({ attempts: 5 });
    const start = Date.now();
    expect((await verify("9999")).status).toBe(429);
    expect(mocks.update.mock.calls[1][0].data.lockedUntil.getTime()).toBeGreaterThanOrEqual(start + 900_000);
  });
  it("rejects expired codes", async () => {
    const row = await mocks.findUnique();
    mocks.findUnique.mockResolvedValue({ ...row, expiresAt: new Date(0) });
    expect((await verify("1234")).status).toBe(400);
    expect(mocks.signToken).not.toHaveBeenCalled();
  });
  it("blocks resending within thirty seconds", async () => {
    mocks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ createdAt: new Date() });
    expect(await issueSignInCode({ id: "test-engineer", email: "test@example.com" })).toMatchObject({ ok: false, status: 429 });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});


describe("production authentication safeguards", () => {
  it("ignores the instant-signin flag in production", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SIGNIN_CODES", "off");
    expect(signInCodesEnabled()).toBe(true);
  });
  it("allows the explicit bypass only in local development", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("SIGNIN_CODES", "off");
    expect(signInCodesEnabled()).toBe(false);
  });
  it("fails closed when production email is missing", async () => {
    vi.stubEnv("NODE_ENV", "production"); mocks.emailConfigured.mockReturnValue(false);
    expect(await issueSignInCode({ id: "test", email: "test@example.com" })).toMatchObject({ ok: false, status: 503 });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
  it("counts concurrent wrong guesses atomically even when both read the same old row", async () => {
    let attempts = 3;
    mocks.update.mockImplementation(async ({ data }) => data.attempts ? { attempts: ++attempts } : { attempts });
    const responses = await Promise.all([verify("9999"), verify("9999")]);
    expect(attempts).toBe(5);
    expect(responses.some(r => r.status === 429)).toBe(true);
    expect(mocks.update.mock.calls.filter(([arg]) => arg.data.attempts).every(([arg]) => arg.data.attempts.increment === 1)).toBe(true);
  });
});
