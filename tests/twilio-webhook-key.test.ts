// Matt's ask (3 Nov): no main Auth Token. Twilio's webhooks are then checked
// by a secret key in their address; the signature still works when the
// Auth Token is set.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

const m = vi.hoisted(() => ({
  customerUpdate: vi.fn(async () => ({ count: 1 })),
  smsUpdate: vi.fn(async () => ({ count: 1 })),
  engineerFind: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { updateMany: m.customerUpdate },
    outboundSms: { updateMany: m.smsUpdate },
    engineer: { findUnique: m.engineerFind, update: vi.fn() },
  },
}));
vi.mock("@/lib/track", () => ({ track: vi.fn() }));
vi.mock("@/lib/suppression", () => ({ suppress: vi.fn(), unsuppress: vi.fn() }));

import { POST as inbound } from "@/app/api/webhooks/sms-inbound/route";
import { POST as status } from "@/app/api/webhooks/sms-status/route";
import { POST as whatsapp } from "@/app/api/webhooks/whatsapp-inbound/route";
import { smsStatusCallbackUrl } from "@/lib/sms";

const KEY = "k3y-0f-32-chars-abcdefabcdefabcd";
const stop = "From=%2B447700900123&Body=STOP";
const req = (url: string, body: string, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });

function sign(url: string, body: string, token: string) {
  const p = new URLSearchParams(body);
  const data = [...p.keys()].sort().reduce((acc, k) => acc + k + p.get(k), url);
  return createHmac("sha1", token).update(data, "utf8").digest("base64");
}

beforeEach(() => {
  vi.stubEnv("TWILIO_AUTH_TOKEN", "");
  vi.stubEnv("TWILIO_WEBHOOK_KEY", KEY);
  vi.stubEnv("APP_URL", "https://tradesura.com");
  m.customerUpdate.mockClear();
  m.smsUpdate.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("without the Auth Token", () => {
  it("STOP with the right key opts the customer out", async () => {
    const res = await inbound(req(`https://tradesura.com/api/webhooks/sms-inbound?key=${KEY}`, stop));
    expect(res.status).toBe(200);
    expect(m.customerUpdate).toHaveBeenCalledWith({ where: { phone: "+447700900123" }, data: { smsOptOut: true } });
  });

  it("a wrong or missing key is refused", async () => {
    expect((await inbound(req("https://tradesura.com/api/webhooks/sms-inbound?key=nope", stop))).status).toBe(403);
    expect((await inbound(req("https://tradesura.com/api/webhooks/sms-inbound", stop))).status).toBe(403);
    expect(m.customerUpdate).not.toHaveBeenCalled();
  });

  it("each text asks Twilio to report back to the address with the key", () => {
    expect(smsStatusCallbackUrl()).toBe(`https://tradesura.com/api/webhooks/sms-status?key=${KEY}`);
  });

  it("delivery reports are taken with the key", async () => {
    const res = await status(req(smsStatusCallbackUrl()!, "MessageSid=SM1&MessageStatus=delivered"));
    expect(res.status).toBe(204);
    expect(m.smsUpdate).toHaveBeenCalled();
  });

  it("WhatsApp replies are checked the same way", async () => {
    expect((await whatsapp(req("https://tradesura.com/api/webhooks/whatsapp-inbound?key=nope", "From=whatsapp%3A%2B447700900123&Body=STOP"))).status).toBe(403);
    expect((await whatsapp(req(`https://tradesura.com/api/webhooks/whatsapp-inbound?key=${KEY}`, "From=whatsapp%3A%2B447700900123&Body=STOP"))).status).toBe(200);
  });

  it("with neither set, the webhooks say they aren't set up", async () => {
    vi.stubEnv("TWILIO_WEBHOOK_KEY", "");
    expect((await inbound(req("https://tradesura.com/api/webhooks/sms-inbound", stop))).status).toBe(500);
    expect(smsStatusCallbackUrl()).toBe("https://tradesura.com/api/webhooks/sms-status");
  });
});

describe("with the Auth Token", () => {
  it("Twilio's signature is still accepted, and a bad one refused", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    vi.stubEnv("TWILIO_WEBHOOK_KEY", "");
    const url = "https://tradesura.com/api/webhooks/sms-inbound";
    expect((await inbound(req(url, stop, { "x-twilio-signature": sign(url, stop, "tok") }))).status).toBe(200);
    expect((await inbound(req(url, stop, { "x-twilio-signature": sign(url, stop, "other") }))).status).toBe(403);
    expect((await inbound(req(url, stop))).status).toBe(403);
  });
});
