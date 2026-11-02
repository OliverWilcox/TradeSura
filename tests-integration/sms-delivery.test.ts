import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { sendSms, notifyEngineer } from "@/lib/sms";
import { POST as statusWebhook } from "@/app/api/webhooks/sms-status/route";
import { GET as statsRoute } from "@/app/api/admin/v1/dashboard/stats/route";
import { POST as offerRoute } from "@/app/api/offer/route";
import { signToken } from "@/lib/auth";
import { call, resetDb } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

// QA-02 and QA-05: whether each text went and arrived. Twilio is never
// called: fetch is replaced with its answer.

// The app's routes read the engineer's bearer token through next/headers.
const engineerAuth = vi.hoisted(() => ({ authorization: "" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ authorization: engineerAuth.authorization }) }));

const TWILIO = { TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "token_test", TWILIO_SMS_NUMBER: "+447700900000" };
const saved = { ...process.env };
const twilioFetch = vi.fn();

beforeEach(async () => {
  await resetDb();
  twilioFetch.mockReset();
  vi.stubGlobal("fetch", twilioFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...saved };
});

const accepts = (sid: string) => twilioFetch.mockResolvedValueOnce(new Response(JSON.stringify({ sid, status: "queued" }), { status: 201 }));

function receipt(params: Record<string, string>, token = TWILIO.TWILIO_AUTH_TOKEN) {
  const url = "http://localhost:3000/api/webhooks/sms-status";
  const body = new URLSearchParams(params);
  const signed = [...body.keys()].sort().reduce((acc, k) => acc + k + body.get(k), url);
  const signature = createHmac("sha1", token).update(signed, "utf8").digest("base64");
  return statusWebhook(new Request(url, { method: "POST", headers: { "x-twilio-signature": signature, "content-type": "application/x-www-form-urlencoded" }, body }));
}

describe("sending a text (QA-05)", () => {
  it("says it didn't go, and records why, when texts aren't set up", async () => {
    for (const k of Object.keys(TWILIO)) delete process.env[k];
    const e = await makeEngineer();
    const res = await sendSms({ engineerId: e.id, to: "+447700900123", body: "Hello", messageClass: "TRANSACTIONAL" });
    expect(res).toMatchObject({ sent: true, delivered: false });
    expect(await prisma.outboundSms.findUniqueOrThrow({ where: { id: res.id! } })).toMatchObject({ status: "SENT", providerSid: null, failureReason: "not_configured", failedAt: expect.any(Date) });
    expect(await notifyEngineer(e.id, "Hello")).toBe(false);
  });

  it("keeps Twilio's ID when it takes the text, and records a refusal", async () => {
    Object.assign(process.env, TWILIO);
    const e = await makeEngineer();
    accepts("SM_ok");
    const ok = await sendSms({ engineerId: e.id, to: "+447700900123", body: "Hello", messageClass: "TRANSACTIONAL" });
    expect(ok.delivered).toBe(true);
    expect(await prisma.outboundSms.findUniqueOrThrow({ where: { id: ok.id! } })).toMatchObject({ providerSid: "SM_ok", failedAt: null });

    twilioFetch.mockResolvedValueOnce(new Response("{\"code\":21211}", { status: 400 }));
    const refused = await sendSms({ engineerId: e.id, to: "+447700900124", body: "Hello", messageClass: "TRANSACTIONAL" });
    expect(refused.delivered).toBe(false);
    expect(await prisma.outboundSms.findUniqueOrThrow({ where: { id: refused.id! } })).toMatchObject({ failureReason: "refused" });

    accepts("SM_note");
    expect(await notifyEngineer(e.id, "Your plan is live")).toBe(true);
  });
});

describe("an offer by text (QA-26)", () => {
  it("tells the engineer whether the text went", async () => {
    for (const k of Object.keys(TWILIO)) delete process.env[k];
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date(), stripeChargesEnabled: true });
    const tier = await prisma.planTier.create({ data: { engineerId: e.id, name: "Boiler Care", priceMonthlyPence: 1500, sortOrder: 0, status: "LIVE" } });
    engineerAuth.authorization = `Bearer ${await signToken({ engineerId: e.id }, "5m")}`;
    const offer = async (phone: string, channel = "sms") =>
      (
        await offerRoute(
          new Request("http://localhost:3000/api/offer", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ firstName: "Ann", lastName: "Example", phone, tierId: tier.id, channel }),
          }),
        )
      ).json();

    expect(await offer("07700900123")).toMatchObject({ ok: true, text: "not_sent" });
    Object.assign(process.env, TWILIO);
    accepts("SM_offer");
    expect(await offer("07700900124")).toMatchObject({ ok: true, text: "sent" });
    expect(await offer("07700900125", "whatsapp")).toMatchObject({ ok: true, text: null });
  });
});

describe("Twilio's delivery receipts (QA-02)", () => {
  it("record delivered and failed, and refuse an unsigned receipt", async () => {
    Object.assign(process.env, TWILIO);
    const e = await makeEngineer();
    accepts("SM_a").mockResolvedValueOnce(new Response(JSON.stringify({ sid: "SM_b" }), { status: 201 }));
    const a = await sendSms({ engineerId: e.id, to: "+447700900123", body: "A", messageClass: "TRANSACTIONAL" });
    const b = await sendSms({ engineerId: e.id, to: "+447700900124", body: "B", messageClass: "TRANSACTIONAL" });

    expect((await receipt({ MessageSid: "SM_a", MessageStatus: "delivered" }, "wrong")).status).toBe(403);
    const unsigned = new Request("http://localhost:3000/api/webhooks/sms-status", { method: "POST", body: new URLSearchParams({ MessageSid: "SM_a", MessageStatus: "delivered" }) });
    expect((await statusWebhook(unsigned)).status).toBe(403);
    expect((await prisma.outboundSms.findUniqueOrThrow({ where: { id: a.id! } })).deliveredAt).toBeNull();

    expect((await receipt({ MessageSid: "SM_a", MessageStatus: "sent" })).status).toBe(204);
    expect((await receipt({ MessageSid: "SM_a", MessageStatus: "delivered" })).status).toBe(204);
    expect((await receipt({ MessageSid: "SM_b", MessageStatus: "undelivered", ErrorCode: "30005" })).status).toBe(204);
    expect(await prisma.outboundSms.findUniqueOrThrow({ where: { id: a.id! } })).toMatchObject({ deliveredAt: expect.any(Date), failedAt: null });
    expect(await prisma.outboundSms.findUniqueOrThrow({ where: { id: b.id! } })).toMatchObject({ deliveredAt: null, failureReason: "twilio_30005" });
  });

  it("decide whether an offer was delivered, failed or is still waiting", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: new Date("2026-06-01") });
    const at = new Date(Date.now() - 3_600_000);
    const offer = async (text: { deliveredAt?: Date; failedAt?: Date } | null) => {
      const p = await makePlan(e.id, (await makeCustomer(e.id)).id, { createdAt: at });
      const sms = text ? await prisma.outboundSms.create({ data: { engineerId: e.id, toPhone: "+447700900123", senderName: "x", body: "x", class: "TRANSACTIONAL", status: "SENT", sendAfter: at, ...text } }) : null;
      await prisma.event.create({ data: { name: "offer_sent", actorType: "ENGINEER", actorId: e.id, ts: at, meta: { planId: p.id, channel: "sms", ...(sms ? { smsId: sms.id } : {}) } } });
    };
    await offer({ deliveredAt: at });
    await offer({ failedAt: at });
    await offer({}); // waiting for its receipt
    await offer(null); // sent before receipts were kept
    const range = { from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() };
    expect((await call(statsRoute, { query: range })).body.offers).toEqual({ delivered: 2, failed: 1, unconfirmed: 1 });
  });
});
