import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), track: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { engineer: m } }));
vi.mock("@/lib/auth", () => ({
  verifyToken: async () => ({
    verified: "1",
    emailVerified: "1",
    email: "test@example.com",
    phone: "+447700900123",
    texted: "1",
  }),
}));
vi.mock("@/lib/sign-in-code", () => ({ sessionToken: m.session, signInCodesEnabled: () => true, issueSignInCode: vi.fn(), maskEmail: vi.fn() }));
vi.mock("@/lib/slug", () => ({ uniqueSlug: async () => "test-heating" }));
vi.mock("@/lib/track", () => ({ track: m.track }));
vi.mock("@/lib/claim", () => ({ normaliseClaimCode: vi.fn(), resolveClaimCode: vi.fn() }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/engineer-welcome-email", () => ({ engineerWelcomeEmailHtml: async () => ({ subject: "Welcome", html: "Test" }) }));
vi.mock("@/lib/sms", () => ({ notifyEngineer: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));
import { POST } from "@/app/api/auth/request/route";
beforeEach(() => {
  vi.resetAllMocks(); m.findUnique.mockResolvedValue(null);
  m.create.mockResolvedValue({ id: "engineer-test", email: "test@example.com" });
  m.session.mockResolvedValue("test-session");
});
it("returns a session after account creation even when signup analytics fails", async () => {
  m.track.mockRejectedValue(new Error("event store unavailable"));
  const response = await POST(new Request("http://localhost/api/auth/request", { method: "POST", body: JSON.stringify({
    email: "test@example.com", signup: { firstName: "Test", lastName: "Engineer", phoneToken: "test", emailToken: "email-proof", gasSafeNo: "123456", tradingName: "Test Heating", businessType: "sole_trader", postcode: "BN1 1AA" },
  }) }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ token: "test-session" });
  expect(m.create).toHaveBeenCalledOnce();
});

// Build Review 3, section 2 — trading name rules and the Companies House name.
const base = { firstName: "Test", lastName: "Engineer", phoneToken: "test", emailToken: "email-proof", gasSafeNo: "123456", postcode: "BN1 1AA" };
function signup(extra: Record<string, unknown>) {
  m.track.mockResolvedValue(undefined);
  return POST(new Request("http://localhost/api/auth/request", { method: "POST", body: JSON.stringify({ email: "test@example.com", signup: { ...base, ...extra } }) }));
}
it("a limited company with a blank trading name trades under its Companies House name", async () => {
  const response = await signup({ tradingName: "", businessType: "ltd", companyNumber: "17325346", legalName: "TRADESURA LTD", soleOwner: true });
  expect(response.status).toBe(200);
  expect(m.create.mock.calls[0][0].data).toMatchObject({ tradingName: "TRADESURA LTD", legalName: "TRADESURA LTD", soleOwner: true });
});
it("stores the legal name alongside a different trading name", async () => {
  await signup({ tradingName: "MW Heating", businessType: "ltd", companyNumber: "17325346", legalName: "TRADESURA LTD", soleOwner: false });
  expect(m.create.mock.calls[0][0].data).toMatchObject({ tradingName: "MW Heating", legalName: "TRADESURA LTD", soleOwner: false });
});
it("a sole trader must enter a trading name", async () => {
  const response = await signup({ tradingName: "", businessType: "sole_trader", legalName: "TRADESURA LTD" });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ field: "tradingName" });
  expect(m.create).not.toHaveBeenCalled();
});
