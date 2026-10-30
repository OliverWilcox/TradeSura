// Installer messages on WhatsApp: the template list Matt submits to Meta, and
// notifyEngineer's choice between WhatsApp and a text.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { engineer: { findUnique: m.findUnique } } }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));

import {
  WHATSAPP_TEMPLATES,
  cleanVar,
  renderTemplate,
  templateForFixedText,
  templateSids,
  type WhatsAppTemplate,
} from "@/lib/whatsapp-templates";
import { notifyEngineer } from "@/lib/sms";

const SID = "HX" + "a".repeat(32);

describe("WhatsApp templates", () => {
  it("every template numbers its variables 1…n, matching its example", () => {
    for (const [key, t] of Object.entries(WHATSAPP_TEMPLATES)) {
      const used = [...t.text.matchAll(/\{\{(\d+)\}\}/g)].map((x) => Number(x[1]));
      expect(used, key).toEqual(Array.from({ length: t.example.length }, (_, i) => i + 1));
    }
  });

  it("no template starts or ends on a variable (Meta rejects those)", () => {
    for (const [key, t] of Object.entries(WHATSAPP_TEMPLATES)) {
      expect(t.text.startsWith("{{"), key).toBe(false);
      expect(/\{\{\d+\}\}$/.test(t.text), key).toBe(false);
    }
  });

  it("fills variables and flattens what Meta won't take", () => {
    expect(renderTemplate({ template: "plan_paused", vars: ["Pat Hughes", "12 February 2027"] })).toBe(
      "TradeSura: Pat Hughes paused their plan until 12 February 2027 instead of cancelling.",
    );
    expect(cleanVar("line one\n\nline    two\t")).toBe("line one line two");
    expect(cleanVar("   ")).toBe("-");
  });

  it("only takes approved Content SIDs for known templates", () => {
    expect(templateSids(JSON.stringify({ plan_kept: SID, nope: SID, plan_paused: "HX123" }))).toEqual({ plan_kept: SID });
    expect(templateSids("not json")).toEqual({});
    expect(templateSids(undefined)).toEqual({});
  });

  it("matches the fixed Gas Safe texts callers already send", () => {
    expect(templateForFixedText("You're Gas Safe verified on TradeSura — your member pack is on its way.")).toBe("gas_safe_verified");
    expect(templateForFixedText("We couldn't verify your Gas Safe number on TradeSura — open the app to check it and try again.")).toBe(
      "gas_safe_failed",
    );
    expect(templateForFixedText("Pat Hughes is keeping their plan after all.")).toBeNull();
  });
});

describe("notifyEngineer channel", () => {
  const fetchMock = vi.fn();
  const kept = { template: "plan_kept" as WhatsAppTemplate, vars: ["Pat Hughes"] };

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_SMS_NUMBER", "+447700900000");
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "+447700900111");
    vi.stubEnv("TWILIO_WHATSAPP_TEMPLATES", JSON.stringify({ plan_kept: SID, gas_safe_verified: SID }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const sent = () => fetchMock.mock.calls.map(([, init]) => new URLSearchParams(String(init.body)));

  it("sends the approved template by WhatsApp when the installer opted in", async () => {
    m.findUnique.mockResolvedValue({ phone: "+447700900222", whatsappOptInAt: new Date() });
    await notifyEngineer("e1", "Pat Hughes is keeping their plan after all.", kept);
    const [p] = sent();
    expect(sent()).toHaveLength(1);
    expect(p.get("To")).toBe("whatsapp:+447700900222");
    expect(p.get("ContentSid")).toBe(SID);
    expect(JSON.parse(p.get("ContentVariables")!)).toEqual({ 1: "Pat Hughes" });
  });

  it("texts instead when they haven't opted in", async () => {
    m.findUnique.mockResolvedValue({ phone: "+447700900222", whatsappOptInAt: null });
    await notifyEngineer("e1", "Pat Hughes is keeping their plan after all.", kept);
    const [p] = sent();
    expect(p.get("To")).toBe("+447700900222");
    expect(p.get("Body")).toBe("Pat Hughes is keeping their plan after all.");
  });

  it("texts instead when the template isn't approved yet", async () => {
    m.findUnique.mockResolvedValue({ phone: "+447700900222", whatsappOptInAt: new Date() });
    await notifyEngineer("e1", "Pat Hughes paused their plan.", { template: "plan_paused", vars: ["Pat Hughes", "1 May"] });
    expect(sent()[0].get("To")).toBe("+447700900222");
  });

  it("falls back to a text when WhatsApp refuses the send", async () => {
    m.findUnique.mockResolvedValue({ phone: "+447700900222", whatsappOptInAt: new Date() });
    fetchMock.mockResolvedValueOnce(new Response("not on WhatsApp", { status: 400 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await notifyEngineer("e1", "Pat Hughes is keeping their plan after all.", kept);
    expect(sent().map((p) => p.get("To"))).toEqual(["whatsapp:+447700900222", "+447700900222"]);
  });

  it("sends a fixed text's template without the caller passing one", async () => {
    m.findUnique.mockResolvedValue({ phone: "+447700900222", whatsappOptInAt: new Date() });
    await notifyEngineer("e1", "You're Gas Safe verified on TradeSura — your member pack is on its way.");
    const [p] = sent();
    expect(p.get("ContentSid")).toBe(SID);
    expect(p.get("ContentVariables")).toBeNull();
  });
});
