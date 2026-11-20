import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET as verification } from "@/app/api/admin/v1/verifications/[engineerId]/route";
import { GET as verifications } from "@/app/api/admin/v1/verifications/route";
import { POST as safetyComplaint } from "@/app/api/admin/v1/customers/[customerId]/safety-complaints/route";
import { POST as portalSafety } from "@/app/api/portal/[token]/safety/route";
import { GET as funnel } from "@/app/api/admin/v1/dashboard/engineer-funnel/route";
import { GET as homeownerFunnel } from "@/app/api/admin/v1/engineers/[engineerId]/homeowner-funnel/route";
import { GET as dashboardHomeowners } from "@/app/api/admin/v1/dashboard/homeowner-funnel/route";
import { POST as reminders } from "@/app/api/admin/v1/letters/batches/[batch]/reminders/route";
import { GET as batches } from "@/app/api/admin/v1/letters/batches/route";
import { GET as followUps } from "@/app/api/admin/v1/follow-ups/route";
import { POST as startScreen } from "@/app/api/admin/v1/follow-ups/tps-screens/route";
import { POST as answerScreen } from "@/app/api/admin/v1/follow-ups/tps-screens/[screenId]/result/route";
import { POST as claimContact } from "@/app/api/admin/v1/letters/codes/[code]/contact/route";
import { POST as claimCall } from "@/app/api/admin/v1/letters/codes/[code]/calls/route";
import { call, resetDb, SUPER_ADMIN, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan, TEST_CARD_URL } from "./factories";

const texts: { to: string; body: string }[] = [];
vi.mock("@/lib/sms", async (original) => ({
  ...(await original<typeof import("@/lib/sms")>()),
  sendPlatformText: vi.fn(async (to: string, body: string) => {
    texts.push({ to, body });
    return true;
  }),
}));

beforeEach(async () => {
  await resetDb();
  texts.length = 0;
  vi.stubEnv("APP_URL", "https://tradesura.com");
});
afterEach(() => vi.unstubAllEnvs());

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const range = (days = 30) => ({ from: daysAgo(days).toISOString(), to: new Date(Date.now() + 60_000).toISOString() });

describe("where the card photo came from", () => {
  it("is on the check page and flagged in the queue when it came from the photo library", async () => {
    const e = await makeEngineer({ gasSafeCardUrl: TEST_CARD_URL, gasSafeCardBackUrl: TEST_CARD_URL, gasSafeCardSource: "library", gasSafeCardBackSource: "camera", gasSafeReviewRequestedAt: daysAgo(1) });
    const camera = await makeEngineer({ gasSafeCardUrl: TEST_CARD_URL, gasSafeCardSource: "camera", gasSafeReviewRequestedAt: daysAgo(1) });
    const old = await makeEngineer({ gasSafeCardUrl: TEST_CARD_URL, gasSafeReviewRequestedAt: daysAgo(1) });
    const detail = await call(verification, { params: { engineerId: e.id } });
    expect(detail.status).toBe(200);
    expect(detail.body.card.source).toEqual({ front: "library", back: "camera" });
    expect((await call(verification, { params: { engineerId: old.id } })).body.card.source).toEqual({ front: null, back: null });
    const list = await call(verifications, { query: { tab: "card" } });
    const flag = new Map(list.body.items.map((i: { id: string; signals: { fromLibrary: boolean } }) => [i.id, i.signals.fromLibrary]));
    expect([flag.get(e.id), flag.get(camera.id), flag.get(old.id)]).toEqual([true, false, false]);
  });
});

describe("a homeowner's safety complaint", () => {
  it("asks for a register re-check of a checked engineer, once, and is recorded", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: daysAgo(90), gasSafeRegisterCheckedAt: daysAgo(80) });
    const c = await makeCustomer(e.id);
    const p = await makePlan(e.id, c.id);
    const res = await call(safetyComplaint, { params: { customerId: c.id }, body: { message: "Left the boiler cover off and the flue loose" } });
    expect(res.status).toBe(200);
    expect(res.body.recheck).toBe("requested");
    const after = await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.gasSafeRecheckRequestedAt).not.toBeNull();
    expect(after.gasSafeRecheckReason).toBe("Safety complaint from a homeowner: Left the boiler cover off and the flue loose");
    const event = await prisma.event.findFirstOrThrow({ where: { name: "safety_complaint" } });
    expect(event.meta).toMatchObject({ engineerId: e.id, customerId: c.id, planId: p.id, from: "admin", recheck: "requested", adminName: SUPER_ADMIN.name });

    const again = await call(safetyComplaint, { params: { customerId: c.id }, body: { message: "They came back and it is still loose" } });
    expect(again.body.recheck).toBe("already_due");
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRecheckReason).toContain("flue loose");
  });

  it("from the plan page goes to TradeSura, not the engineer, and leaves an unchecked engineer for the register check", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: daysAgo(5) });
    const c = await makeCustomer(e.id);
    const p = await makePlan(e.id, c.id);
    const post = (body: unknown) => portalSafety(new Request(`http://localhost:3000/api/portal/${p.portalToken}/safety`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token: p.portalToken! }) });
    expect((await post({ message: "short" })).status).toBe(400);
    expect((await post({ message: "I can smell gas since the visit" })).status).toBe(409);
    const ok = await post({ message: "The new radiator valve was left leaking" });
    expect(ok.status).toBe(200);
    const event = await prisma.event.findFirstOrThrow({ where: { name: "safety_complaint" } });
    expect(event).toMatchObject({ actorType: "CUSTOMER", actorId: c.id });
    expect(event.meta).toMatchObject({ from: "homeowner", recheck: "not_checked", reason: "The new radiator valve was left leaking" });
    expect((await prisma.engineer.findUniqueOrThrow({ where: { id: e.id } })).gasSafeRecheckRequestedAt).toBeNull();
  });

  it("needs customers:notes", async () => {
    const e = await makeEngineer();
    const c = await makeCustomer(e.id);
    expect((await call(safetyComplaint, { params: { customerId: c.id }, as: withPermissions("customers:read"), body: { message: "Something unsafe was left" } })).status).toBe(403);
  });
});

describe("the engineer funnel by channel", () => {
  it("starts from sign-ups for a channel other than letters", async () => {
    await makeEngineer({ createdAt: daysAgo(3), attribution: { heardVia: "online" }, town: "Leeds" });
    await makeEngineer({ createdAt: daysAgo(3), attribution: { heardVia: "online" }, town: "York", gasSafeCardUrl: TEST_CARD_URL, gasSafeVerifiedAt: daysAgo(2) });
    await makeEngineer({ createdAt: daysAgo(3), attribution: { heardVia: "engineer" } });
    await makeEngineer({ createdAt: daysAgo(3), attribution: { heardVia: "other", referralCode: "SMITH25" } });
    await makeEngineer({ createdAt: daysAgo(3), attribution: { heardVia: "job" } });
    await makeEngineer({ createdAt: daysAgo(40), attribution: { heardVia: "online" } });
    const of = async (query: Record<string, string>) => (await call(funnel, { query: { ...range(), ...query } })).body;
    const website = await of({ channel: "website" });
    expect(website).toMatchObject({ start: "signups", signups: 2, channel: "website" });
    const step = (key: string) => website.steps.find((s: { key: string }) => s.key === key);
    expect(step("letters_posted")).toMatchObject({ count: null, noData: "Only letters have this step" });
    expect(step("signed_up")).toMatchObject({ count: 2, ofStart: 1 });
    expect(step("card_check_passed").count).toBe(1);
    expect((await of({ channel: "referral" })).signups).toBe(2);
    expect((await of({ channel: "job" })).signups).toBe(1);
    expect((await of({ channel: "all" })).signups).toBe(5);
    expect((await of({ channel: "website", town: "leeds" })).signups).toBe(1);
    expect((await of({})).start).toBe("letters");
    const refused = await call(funnel, { query: { ...range(), channel: "website", batch: "2026-11-A" } });
    expect(refused.status).toBe(400);
  });
});

describe("the homeowner funnel", () => {
  it("is the conversion report for one installer, their staff's offers included, and for everyone on the dashboard", async () => {
    const e = await makeEngineer({ gasSafeVerifiedAt: daysAgo(30) });
    const staff = await makeEngineer({ ownerId: e.id });
    const other = await makeEngineer({ gasSafeVerifiedAt: daysAgo(30) });
    const c = await makeCustomer(e.id);
    const joined = await makePlan(e.id, c.id, { activatedAt: daysAgo(2), linkOpenedAt: daysAgo(2) });
    const thinking = await makePlan(e.id, c.id, { status: "PENDING", activatedAt: null, linkOpenedAt: daysAgo(2) });
    await prisma.offerSession.createMany({
      data: [
        { token: "t1", engineerId: e.id, reason: "service", variant: "A", channel: "show", planId: joined.id, createdAt: daysAgo(2) },
        { token: "t2", engineerId: e.id, soldById: staff.id, reason: "service", variant: "B", channel: "sms", planId: thinking.id, createdAt: daysAgo(2) },
        { token: "t3", engineerId: other.id, reason: "repair", variant: "A", channel: "sms", createdAt: daysAgo(2) },
      ],
    });
    const mine = (await call(homeownerFunnel, { params: { engineerId: e.id }, query: range() })).body;
    expect(mine.totals).toEqual({ offers: 2, viewed: 2, joined: 1, thinking: 1, joinedLater: 0 });
    expect(mine.rows.map((r: { variant: string }) => r.variant)).toEqual(["A", "B"]);
    expect((await call(homeownerFunnel, { params: { engineerId: staff.id }, query: range() })).body.totals.offers).toBe(1);
    expect((await call(dashboardHomeowners, { query: range() })).body.totals.offers).toBe(3);
  });
});

describe("letter non-responders", () => {
  async function batch(postedDaysAgo: number) {
    await prisma.letterBatch.create({ data: { name: "2026-11-A", area: "Leeds", postedOn: daysAgo(postedDaysAgo), letters: 3 } });
    const base = { firstName: "Sam", letterBatch: "2026-11-A", variantCell: "A", town: "Leeds", reservedUntil: new Date(Date.now() + 20 * DAY) };
    await prisma.claimCode.createMany({
      data: [
        { ...base, code: "ASH7K3Q", businessName: "Ash Gas", claimedAt: daysAgo(4), mobile: "+447700900501", textConsentAt: daysAgo(4), tradingTown: "Leeds" },
        { ...base, code: "BIRCH7K3Q", businessName: "Birch Heating", claimedAt: daysAgo(4), mobile: "+447700900502" },
        { ...base, code: "CEDAR7K3Q", businessName: "Cedar Boilers" },
      ],
    });
  }

  it("are texted once, only where they ticked the box on the claim page, from the second letter's date", async () => {
    await batch(5);
    expect((await call(reminders, { params: { batch: "2026-11-A" } })).status).toBe(409);
    await prisma.letterBatch.update({ where: { name: "2026-11-A" }, data: { postedOn: daysAgo(11) } });
    const listed = (await call(batches)).body.items[0];
    expect(listed).toMatchObject({ notSignedUp: 2, canText: 1, texted: 0 });
    const sent = await call(reminders, { params: { batch: "2026-11-A" } });
    expect(sent.body).toEqual({ sent: 1, failed: 0, optedOut: 0, left: 0 });
    expect(texts).toHaveLength(1);
    expect(texts[0]!.to).toBe("+447700900501");
    expect(texts[0]!.body).toMatch(/^TradeSura: your Founding Member spot in Leeds is held until .+\. Finish setting up with your code ASH7K3Q: https:\/\/tradesura\.com\/c\/ASH7K3Q\/app\?t=.+ Reply STOP to opt out\.$/);
    expect((await call(batches)).body.items[0]).toMatchObject({ canText: 0, texted: 1 });
    expect((await call(reminders, { params: { batch: "2026-11-A" } })).status).toBe(409);
    expect((await call(reminders, { params: { batch: "2026-11-A" }, as: withPermissions("letters:read") })).status).toBe(403);
  });

  it("who gave a mobile are a call list for those with letters, screened against TPS and CTPS", async () => {
    await batch(11);
    const ash = await makeEngineer({ gasSafeVerifiedAt: daysAgo(60) });
    const list = await call(followUps, { query: { tab: "letters" } });
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { code: string }) => i.code)).toEqual(["ASH7K3Q", "BIRCH7K3Q"]);
    expect(list.body.items[0]).toMatchObject({ business: "Ash Gas", town: "Leeds", textConsent: true, phone: expect.not.stringContaining("900501"), tps: { status: "not_screened" } });
    expect(list.body.counts.letters).toBe(2);
    expect((await call(followUps, { query: { tab: "letters" }, as: withPermissions("engineers:read") })).status).toBe(403);
    expect((await call(followUps, { as: withPermissions("engineers:read") })).body.counts.letters).toBeNull();

    const screen = await call(startScreen, {});
    expect(screen.status).toBe(200);
    expect(screen.body.numbers).toEqual(expect.arrayContaining(["07700900501", "07700900502", ash.phone!.replace("+44", "0")]));
    expect((await call(followUps)).body.tps).toMatchObject({ due: 3, waiting: { id: screen.body.id, numbers: 3 } });
    const answered = await call(answerScreen, { params: { screenId: screen.body.id }, body: { listed: "registered", numbers: ["07700 900501", "7700900999"] } });
    expect(answered.body).toMatchObject({ registered: 1, clear: 2, ignored: 1 });
    const after = (await call(followUps, { query: { tab: "letters" } })).body;
    expect(after.items.map((i: { tps: { status: string } }) => i.tps.status)).toEqual(["registered", "clear"]);
    expect(after.tps).toMatchObject({ due: 0, waiting: null });
    expect((await call(startScreen, {})).status).toBe(409);
    expect((await call(answerScreen, { params: { screenId: screen.body.id }, body: { listed: "clear", numbers: [] } })).status).toBe(409);
    expect((await call(startScreen, { as: withPermissions("engineers:read") })).status).toBe(403);
  });

  it("can be revealed and their calls logged, with letters in the role", async () => {
    await batch(11);
    expect((await call(claimContact, { params: { code: "ASH7K3Q" } })).body).toEqual({ phone: "+447700900501" });
    expect((await call(claimContact, { params: { code: "ASH7K3Q" }, as: withPermissions("pii:reveal") })).status).toBe(403);
    expect((await call(claimCall, { params: { code: "ASH7K3Q" }, body: { note: "Wants a call back on Monday" } })).status).toBe(200);
    const list = await call(followUps, { query: { tab: "letters" } });
    expect(list.body.items[0].lastCall).toMatchObject({ by: SUPER_ADMIN.name, note: "Wants a call back on Monday" });
    expect(await prisma.event.count({ where: { name: "admin_contact_revealed", meta: { path: ["subjectId"], equals: "ASH7K3Q" } } })).toBe(1);
  });
});
