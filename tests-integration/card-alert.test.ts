import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { POST as uploadCard } from "@/app/api/settings/gas-safe-card/route";
import { alertCardUpload, queueCardCheckAndAlert } from "@/lib/card-alert";
import { resetDb } from "./helpers";
import { makeEngineer, readCard, TEST_CARD_JPEG } from "./factories";

// 3.2 (QA-08): the instant alert to the team when an engineer uploads their
// Gas Safe ID card. Matt, 26 Nov: it waits for the automatic read and carries
// both numbers, the read and the photos. Nothing is sent: email and text are
// recorded, and the card store is faked.

const sent = vi.hoisted(() => ({ email: vi.fn<(opts: unknown) => Promise<void>>(async () => {}), text: vi.fn(async () => true), engineerId: null as string | null, stored: 0 }));
vi.mock("@/lib/email", () => ({ sendEmail: sent.email, emailConfigured: () => true }));
vi.mock("@/lib/sms", () => ({ textStaff: sent.text }));
vi.mock("@/lib/auth", () => ({ getEngineerId: async () => sent.engineerId }));
const JPEG = Buffer.from(TEST_CARD_JPEG, "base64");
vi.mock("@/lib/gas-safe-card", async (actual) => ({
  ...(await actual<typeof import("@/lib/gas-safe-card")>()),
  storeGasSafeCard: async () => ({ ok: true, url: `https://x.private.blob.vercel-storage.com/gas-safe-cards/card-${++sent.stored}.jpg` }),
  readPrivateCard: async () => ({ bytes: new Uint8Array(JPEG).buffer, type: "image/jpeg" }),
}));
const check = vi.hoisted(() => ({ run: null as null | ReturnType<typeof vi.fn>, reads: null as null | ReturnType<typeof vi.fn> }));
vi.mock("@/lib/admin/verifications", async (actual) => {
  const real = await actual<typeof import("@/lib/admin/verifications")>();
  check.run = vi.fn(real.runCardCheck);
  return { ...real, runCardCheck: check.run };
});
vi.mock("@/lib/admin/card-check", async (actual) => {
  const real = await actual<typeof import("@/lib/admin/card-check")>();
  check.reads = vi.fn(real.currentReads);
  return { ...real, currentReads: check.reads };
});

const FRONT = "https://x.private.blob.vercel-storage.com/gas-safe-cards/front.jpg";
const BACK = "https://x.private.blob.vercel-storage.com/gas-safe-cards/back.jpg";
type Sent = { to: string; subject: string; html: string; attachments: { filename: string; contentId?: string; contentType: string; content: Buffer }[] };
const lastEmail = () => sent.email.mock.calls.at(-1)![0] as Sent;

const saved = { ...process.env };
beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
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
  // A 6-digit number is the business's registration number, not a licence.
  expect(lastEmail().html).toMatch(/Registration number<\/td>\s*<td[^>]*>612844<\/td>/);
  expect(sent.text).toHaveBeenCalledWith("+447700900999", `TradeSura: Gas Safe card to check from Wood Heating. https://admin.tradesura.example/verification/${e.id}`);
  // Nothing about how to reach them.
  expect(JSON.stringify(sent.email.mock.calls)).not.toContain(e.email);
  expect(await prisma.event.findFirst({ where: { name: "verification_alert_sent" } })).toMatchObject({ meta: { engineerId: e.id, from: "settings", emails: 2, texts: 1 } });
});

it("carries both numbers, the automatic read and the front and back photos inline", async () => {
  const e = await makeEngineer({ tradingName: "Wood Heating", firstName: "Dave", lastName: "Wood", gasSafeNo: "1234567", gasSafeRegistrationNo: "584123", gasSafeCardUrl: FRONT, gasSafeCardBackUrl: BACK });
  await readCard(e.id, { backUrl: BACK, categories: ["Central heating boilers"] });
  await alertCardUpload(e.id, "signup");
  const { html, attachments } = lastEmail();
  expect(html).toMatch(/Licence number<\/td>\s*<td[^>]*>1234567<\/td>/);
  expect(html).toMatch(/Registration number<\/td>\s*<td[^>]*>584123<\/td>/);
  expect(html).toContain("Read in full, nothing to flag");
  expect(html.match(/matches what they gave/g)).toHaveLength(2);
  expect(html).toContain("Dave Wood");
  expect(html).toContain("30 June 2027");
  expect(html).toContain("1 category of work read");
  expect(html).toContain(`src="cid:card-front"`);
  expect(html).toContain(`src="cid:card-back"`);
  expect(attachments.map((a) => [a.contentId, a.contentType])).toEqual([
    ["card-front", "image/jpeg"],
    ["card-back", "image/jpeg"],
  ]);
  expect(attachments[0].content.equals(JPEG)).toBe(true);
  // The photos travel in the email, never as a link into the card store.
  expect(html).not.toContain("blob.vercel-storage.com");
});

it("says the read result isn't available when it can't be looked up, and still shows the photos (QA, 26 Nov)", async () => {
  const e = await makeEngineer({ gasSafeCardUrl: FRONT, gasSafeCardBackUrl: BACK });
  await readCard(e.id, { backUrl: BACK });
  check.reads!.mockRejectedValueOnce(new Error("database unavailable"));
  await alertCardUpload(e.id, "signup");
  expect(sent.email).toHaveBeenCalledTimes(2);
  const { html, attachments } = lastEmail();
  expect(html).toContain("Read result not available");
  expect(html).not.toContain("no card photo");
  expect(attachments.map((a) => a.contentId)).toEqual(["card-front", "card-back"]);
});

it("flags a card whose numbers aren't the ones they gave", async () => {
  const e = await makeEngineer({ gasSafeNo: "7654321", gasSafeRegistrationNo: "584123", gasSafeCardUrl: FRONT });
  await readCard(e.id, { licenceNo: "1234567" });
  await alertCardUpload(e.id, "signup");
  const { html } = lastEmail();
  expect(html).toContain("Read in full, with 1 thing to check");
  expect(html).toContain("they gave 7654321");
  expect(html).toContain("The card's licence number, 1234567, isn't the 7654321 they gave.");
});

it("goes once an engineer's new card in Settings has been read, saying what the read found", async () => {
  const e = await makeEngineer();
  sent.engineerId = e.id;
  let readsWhenSent = -1;
  sent.email.mockImplementationOnce(async () => {
    readsWhenSent = await prisma.gasSafeCardRead.count({ where: { engineerId: e.id } });
  });
  const res = await uploadCard(new Request("http://localhost:3000/api/settings/gas-safe-card", { method: "POST", body: JSON.stringify({ base64: TEST_CARD_JPEG, mimeType: "image/jpeg" }) }));
  expect(res.status).toBe(200);
  expect(check.run).toHaveBeenCalledOnce();
  expect(readsWhenSent).toBe(1);
  // No reading service in tests, so the read says it isn't set up.
  expect(lastEmail().html).toContain("Not read yet");
  expect(lastEmail().html).toContain("isn't set up");
  expect(lastEmail().attachments.map((a) => a.contentId)).toEqual(["card-front"]);
  expect(lastEmail().html).toContain("No photo of the back was sent.");
  expect(sent.text).toHaveBeenCalledOnce();
});

it("doesn't hold the alert for a slow read, and stays until the read is saved", async () => {
  const e = await makeEngineer({ gasSafeCardUrl: FRONT });
  // Set up, so a missing read means it's still going. The read itself is held below, so nothing is called.
  process.env.ANTHROPIC_API_KEY = "sk-test-never-called";
  let finish!: () => void;
  check.run!.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve(null))));
  let settled = false;
  const done = (queueCardCheckAndAlert(e.id, "settings", 20) as Promise<void>).then(() => {
    settled = true;
  });
  await vi.waitFor(() => expect(sent.email).toHaveBeenCalledTimes(2));
  expect(lastEmail().html).toContain("The automatic check is still reading the card.");
  expect(settled).toBe(false);
  finish();
  await done;
  expect(settled).toBe(true);
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
