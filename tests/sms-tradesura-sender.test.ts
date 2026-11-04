// Matt, 3 Nov: every text, the engineer's ones included, goes through the
// Messaging Service so it shows "TradeSura", and the STOP line reads
// "Reply STOP to 07366 234255".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "o1", ...data })),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    engineer: { findUniqueOrThrow: vi.fn(async () => ({ tradingName: "MW Heating", slug: "mw-heating" })) },
    customer: { findFirst: vi.fn(async () => null) },
    outboundSms: { create: m.create, update: vi.fn(async () => ({})) },
  },
}));
vi.mock("@/lib/suppression", () => ({ isSuppressed: vi.fn(async () => false) }));

const fetchMock = vi.fn();
const sentParams = () => new URLSearchParams(String(fetchMock.mock.calls[0][1].body));

async function load() {
  vi.resetModules();
  return import("@/lib/sms");
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ sid: "SM1" }), { status: 201 }));
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
  vi.stubEnv("TWILIO_API_KEY_SID", "SK_test");
  vi.stubEnv("TWILIO_API_KEY_SECRET", "secret");
  vi.stubEnv("TWILIO_SMS_NUMBER", "+447366234255");
  vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG_test");
  vi.useFakeTimers().setSystemTime(new Date("2026-11-04T12:00:00"));
  m.create.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("engineer texts to customers", () => {
  it("go through the Messaging Service, not from the engineer's name", async () => {
    const { sendSms } = await load();
    await sendSms({ engineerId: "e1", to: "+447700900123", body: "Hi Sam, it's MW Heating.", messageClass: "ENGINEER_INITIATED" as never });
    expect(sentParams().get("MessagingServiceSid")).toBe("MG_test");
    expect(sentParams().has("From")).toBe(false);
  });

  it("marketing texts end with Matt's STOP line", async () => {
    const { sendSms } = await load();
    await sendSms({ engineerId: "e1", to: "+447700900123", body: "Hi Sam, it's MW Heating.", messageClass: "MARKETING" });
    expect(sentParams().get("Body")).toBe("Hi Sam, it's MW Heating. Reply STOP to 07366 234255");
  });

  it("without a service, they come from the TradeSura name", async () => {
    vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "");
    const { sendSms } = await load();
    await sendSms({ engineerId: "e1", to: "+447700900123", body: "Hi", messageClass: "MARKETING" });
    expect(sentParams().get("From")).toBe("TradeSura");
  });
});
