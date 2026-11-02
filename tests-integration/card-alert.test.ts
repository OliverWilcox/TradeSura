import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST as uploadCard } from "@/app/api/settings/gas-safe-card/route";
import { alertCardUpload } from "@/lib/card-alert";
import { resetDb } from "./helpers";
import { makeEngineer } from "./factories";

// 3.2 (QA-08): the instant alert to the team when an engineer uploads their
// Gas Safe ID card. Nothing is sent: email and text are recorded.

const sent = vi.hoisted(() => ({ email: vi.fn(async () => {}), text: vi.fn(async () => true), engineerId: null as string | null }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email, emailConfigured: () => true }));
vi.mock("@/lib/sms", () => ({ textStaff: sent.text }));
vi.mock("@/lib/auth", () => ({ getEngineerId: async () => sent.engineerId }));
vi.mock("@/lib/gas-safe-card", async (actual) => ({ ...(await actual<typeof import("@/lib/gas-safe-card")>()), storeGasSafeCard: async () => ({ ok: true, url: "https://x.public.blob.vercel-storage.com/card.png" }) }));

const saved = { ...process.env };
beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  Object.assign(process.env, { VERIFICATION_ALERT_EMAIL: "matt@tradesura.example, ops@tradesura.example", VERIFICATION_ALERT_SMS: "+447700900999", ADMIN_APP_URL: "https://admin.tradesura.example/" });
});
afterEach(() => {
  process.env = { ...saved };
});

it("emails and texts the team, with a link to the check page, and records it", async () => {
  const e = await makeEngineer({ tradingName: "Wood Heating", gasSafeNo: "612844" });
  await alertCardUpload(e.id, "settings");
  expect(sent.email).toHaveBeenCalledTimes(2);
  expect(sent.email).toHaveBeenCalledWith(
    expect.objectContaining({ to: "matt@tradesura.example", subject: "Gas Safe card to check: Wood Heating", html: expect.stringContaining(`https://admin.tradesura.example/verification/${e.id}`) }),
  );
  expect(sent.text).toHaveBeenCalledWith("+447700900999", `TradeSura: Gas Safe card to check from Wood Heating. https://admin.tradesura.example/verification/${e.id}`);
  // Nothing about them beyond the business and the number.
  expect(JSON.stringify(sent.email.mock.calls)).not.toContain(e.email);
  expect(await prisma.event.findFirst({ where: { name: "verification_alert_sent" } })).toMatchObject({ meta: { engineerId: e.id, from: "settings", emails: 2, texts: 1 } });
});

it("goes when an engineer uploads their card in Settings", async () => {
  const e = await makeEngineer();
  sent.engineerId = e.id;
  const res = await uploadCard(new Request("http://localhost:3000/api/settings/gas-safe-card", { method: "POST", body: JSON.stringify({ base64: "aGVsbG8=", mimeType: "image/png" }) }));
  expect(res.status).toBe(200);
  expect(sent.email).toHaveBeenCalled();
  expect(sent.text).toHaveBeenCalledOnce();
});

it("sends nothing when no one is set to get it, and a failed send doesn't stop the rest", async () => {
  const e = await makeEngineer();
  process.env.VERIFICATION_ALERT_EMAIL = "";
  process.env.VERIFICATION_ALERT_SMS = "";
  await alertCardUpload(e.id, "signup");
  expect(sent.email).not.toHaveBeenCalled();
  expect(sent.text).not.toHaveBeenCalled();

  process.env.VERIFICATION_ALERT_EMAIL = "a@tradesura.example,b@tradesura.example";
  sent.email.mockRejectedValueOnce(new Error("Failed to send email"));
  await alertCardUpload(e.id, "signup");
  expect(sent.email).toHaveBeenCalledTimes(2);
});
