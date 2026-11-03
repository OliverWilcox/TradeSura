// Matt, 3 Nov: send with an API key (never the main Auth Token), through a
// Messaging Service with "TradeSura" as the sender and the 07366 number behind it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { sendVerificationCode } from "@/lib/sms";
import { twilioAuth } from "@/lib/twilio-auth";

const fetchMock = vi.fn();
const sent = () => fetchMock.mock.calls.map(([url, init]) => ({ url: String(url), auth: init.headers.Authorization as string, p: new URLSearchParams(String(init.body)) }));
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "main-token");
  vi.stubEnv("TWILIO_SMS_NUMBER", "+447366234255");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Twilio sign-in", () => {
  it("uses the API key when there is one, not the Auth Token", () => {
    vi.stubEnv("TWILIO_API_KEY_SID", "SK_test");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "key-secret");
    expect(twilioAuth()).toEqual({ accountSid: "AC_test", authorization: basic("SK_test", "key-secret") });
  });

  it("falls back to the Auth Token for older setups", () => {
    expect(twilioAuth()?.authorization).toBe(basic("AC_test", "main-token"));
  });

  it("an API key alone is enough to send", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_API_KEY_SID", "SK_test");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "key-secret");
    expect(twilioAuth()).not.toBeNull();
  });
});

describe("Messaging Service", () => {
  it("TradeSura's own texts (sign-in codes) go through the service, with the account's URL", async () => {
    vi.stubEnv("TWILIO_API_KEY_SID", "SK_test");
    vi.stubEnv("TWILIO_API_KEY_SECRET", "key-secret");
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG_test");
    await sendVerificationCode("+447700900123", "1234");
    const [s] = sent();
    expect(s.url).toContain("/Accounts/AC_test/Messages.json");
    expect(s.auth).toBe(basic("SK_test", "key-secret"));
    expect(s.p.get("MessagingServiceSid")).toBe("MG_test");
    expect(s.p.has("From")).toBe(false);
  });

  it("without a service, codes still come from the number", async () => {
    await sendVerificationCode("+447700900123", "1234");
    expect(sent()[0].p.get("From")).toBe("+447366234255");
  });
});
