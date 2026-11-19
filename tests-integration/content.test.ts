import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as list, POST as add } from "@/app/api/admin/v1/content/reasons/route";
import { PUT as order } from "@/app/api/admin/v1/content/reasons/order/route";
import { GET as detail, PUT as active } from "@/app/api/admin/v1/content/reasons/[reason]/route";
import { POST as addVariant, PUT as split } from "@/app/api/admin/v1/content/reasons/[reason]/variants/route";
import { PUT as save, DELETE as remove } from "@/app/api/admin/v1/content/reasons/[reason]/variants/[variant]/route";
import { GET as report } from "@/app/api/admin/v1/content/report/route";
import { reasonContent, reasonList } from "@/lib/visit-reasons";
import { call, resetDb, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(resetDb);

type P<T extends Record<string, string>> = T;
const at = <T extends Record<string, string>>(params: T): P<T> => params;

const HOUR = 3_600_000;

async function readA(reason: string) {
  const res = await call(detail, { params: at({ reason }) });
  expect(res.status).toBe(200);
  return { ...res.body, a: res.body.variants.find((v: { variant: string }) => v.variant === "A") };
}

const saveBody = (over: Record<string, unknown> = {}) => ({
  label: "New boiler fitted",
  headline: "Keep your new boiler's warranty valid",
  worries: ["Will I remember the yearly service?"],
  messages: ["Your plan books the yearly service in for you."],
  graphicKey: "new-boiler",
  benefitOrder: ["ANNUAL_SERVICE", "WARRANTY_VALID"],
  preselect: "middle",
  followUp2d: "Hi {first}, {engineer} here. My plan books your yearly service in: {link}",
  followUp7d: "Hi {first}, {engineer} again. The plan is still here: {link}",
  ...over,
});

describe("the list of reasons", () => {
  it("starts as the five shipped reasons showing their defaults, one variant each", async () => {
    const res = await call(list);
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { reason: string; label: string; edited: boolean; active: boolean; shipped: boolean }) => [r.reason, r.label, r.edited, r.active, r.shipped])).toEqual([
      ["new_boiler", "New boiler fitted", false, true, true],
      ["breakdown", "Breakdown / repair", false, true, true],
      ["yearly_service", "Yearly service", false, true, true],
      ["landlord", "Landlord safety check", false, true, true],
      ["other", "Other work", false, true, true],
    ]);
    expect(res.body.items[0].variants).toEqual([{ variant: "A", weight: 1, share: 100 }]);
  });

  it("adds a reason of Matt's own at the end, refuses a second with the same name, and the app lists it", async () => {
    const res = await call(add, { body: { label: "Smart thermostat fitted" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reason: "smart_thermostat_fitted", label: "Smart thermostat fitted", shipped: false, active: true, edited: true, sortOrder: 5 });
    expect((await call(add, { body: { label: "Smart Thermostat fitted!" } })).status).toBe(409);
    expect((await call(add, { body: { label: "!!!" } })).status).toBe(400);
    expect((await reasonList()).map((r) => r.reason)).toEqual(["new_boiler", "breakdown", "yearly_service", "landlord", "other", "smart_thermostat_fitted"]);
    expect((await readA("smart_thermostat_fitted")).a.headline).toBe("Keep your boiler looked after, all year");
    expect(await prisma.event.count({ where: { name: "visit_content_changed", actorType: "ADMIN" } })).toBe(1);
  });

  it("reorders the list and hides a reason, which the installer's list follows; one reason always stays", async () => {
    const reordered = await call(order, { method: "PUT", body: { reasons: ["breakdown", "new_boiler", "other", "yearly_service", "landlord"] } });
    expect(reordered.status).toBe(200);
    expect(reordered.body.items.map((r: { reason: string }) => r.reason)).toEqual(["breakdown", "new_boiler", "other", "yearly_service", "landlord"]);
    expect((await reasonList()).map((r) => r.reason)).toEqual(["breakdown", "new_boiler", "other", "yearly_service", "landlord"]);
    expect((await call(order, { method: "PUT", body: { reasons: ["breakdown", "new_boiler"] } })).status).toBe(400);

    const hidden = await call(active, { method: "PUT", params: at({ reason: "other" }), body: { active: false } });
    expect(hidden.status).toBe(200);
    expect(hidden.body.items.find((r: { reason: string }) => r.reason === "other").active).toBe(false);
    expect((await reasonList()).map((r) => r.reason)).toEqual(["breakdown", "new_boiler", "yearly_service", "landlord"]);
    expect((await reasonContent("other", "seed")).headline).toBe("Keep your boiler looked after, all year");

    for (const reason of ["breakdown", "new_boiler", "yearly_service"]) {
      expect((await call(active, { method: "PUT", params: at({ reason }), body: { active: false } })).status).toBe(200);
    }
    const last = await call(active, { method: "PUT", params: at({ reason: "landlord" }), body: { active: false } });
    expect(last.status).toBe(409);
    expect(await reasonList()).toEqual([{ reason: "landlord", label: "Landlord safety check" }]);
    expect((await call(detail, { params: at({ reason: "nope" }) })).status).toBe(404);
  });
});

describe("a reason's content", () => {
  it("saves variant A over the default, which the customer page then reads", async () => {
    const before = await readA("new_boiler");
    expect(before.a.saved).toBe(false);
    expect(before.options.benefits).toEqual(expect.arrayContaining([{ code: "ANNUAL_SERVICE", title: "Annual boiler service" }]));

    const res = await call(save, { method: "PUT", params: at({ reason: "new_boiler", variant: "A" }), body: saveBody({ label: "Boiler fitted", headline: "Your new boiler, looked after" }) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reason: "new_boiler", label: "Boiler fitted", variants: [{ variant: "A", saved: true, headline: "Your new boiler, looked after", preselect: "middle", benefitOrder: ["ANNUAL_SERVICE", "WARRANTY_VALID"] }] });
    const content = await reasonContent("new_boiler", "any-token");
    expect(content).toMatchObject({ variant: "A", label: "Boiler fitted", headline: "Your new boiler, looked after", worries: ["Will I remember the yearly service?"] });
    expect((await reasonList())[0]).toEqual({ reason: "new_boiler", label: "Boiler fitted" });
  });

  it("refuses insurance wording, an unknown benefit code, an unknown graphic and a missing variant", async () => {
    const cover = await call(save, { method: "PUT", params: at({ reason: "new_boiler", variant: "A" }), body: saveBody({ messages: ["Full boiler cover for £9 a month."] }) });
    expect(cover.status).toBe(400);
    expect(cover.body.error.message).toMatch(/insurance/);
    expect(cover.body.error.fields.messages[0]).toMatch(/cover/);
    expect((await call(save, { method: "PUT", params: at({ reason: "new_boiler", variant: "A" }), body: saveBody({ followUp7d: "Hi {first}, we insure your boiler: {link}" }) })).status).toBe(400);
    expect((await call(save, { method: "PUT", params: at({ reason: "new_boiler", variant: "A" }), body: saveBody({ benefitOrder: ["FREE_HOLIDAY"] }) })).body.error.fields).toEqual({ benefitOrder: ["No benefit has the code FREE_HOLIDAY."] });
    expect((await call(save, { method: "PUT", params: at({ reason: "new_boiler", variant: "A" }), body: saveBody({ graphicKey: "unicorn" }) })).status).toBe(400);
    expect((await call(save, { method: "PUT", params: at({ reason: "new_boiler", variant: "B" }), body: saveBody() })).status).toBe(404);
    expect((await call(save, { method: "PUT", params: at({ reason: "new_boiler", variant: "A" }), body: saveBody({ extra: 1 }) })).status).toBe(400);
    expect(await prisma.visitReasonContent.count()).toBe(0);
  });

  it("needs content:write to change and content:read to see", async () => {
    expect((await call(detail, { params: at({ reason: "other" }), as: withPermissions("content:read") })).status).toBe(200);
    expect((await call(detail, { params: at({ reason: "other" }), as: withPermissions("engineers:read") })).status).toBe(403);
    expect((await call(save, { method: "PUT", params: at({ reason: "other", variant: "A" }), body: saveBody(), as: withPermissions("content:read") })).status).toBe(403);
  });
});

describe("split tests", () => {
  it("adds a variant with no traffic, splits it, picks by weight, and takes it out again", async () => {
    const added = await call(addVariant, { params: at({ reason: "breakdown" }) });
    expect(added.status).toBe(200);
    expect(added.body.variants.map((v: { variant: string; weight: number; share: number }) => [v.variant, v.weight, v.share])).toEqual([
      ["A", 1, 100],
      ["B", 0, 0],
    ]);
    expect(added.body.variants[1].headline).toBe("Glad it's sorted. Let's keep it that way");
    expect((await reasonContent("breakdown", "x")).variant).toBe("A");

    await call(save, { method: "PUT", params: at({ reason: "breakdown", variant: "B" }), body: saveBody({ label: "Breakdown / repair", headline: "First in the diary next time" }) });
    const even = await call(split, { method: "PUT", params: at({ reason: "breakdown" }), body: { weights: [{ variant: "A", weight: 50 }, { variant: "B", weight: 50 }] } });
    expect(even.status).toBe(200);
    expect(even.body.variants.map((v: { variant: string; share: number }) => [v.variant, v.share])).toEqual([["A", 50], ["B", 50]]);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add((await reasonContent("breakdown", `token-${i}`)).variant);
    expect([...seen].sort()).toEqual(["A", "B"]);
    expect((await reasonContent("breakdown", "token-1")).variant).toBe((await reasonContent("breakdown", "token-1")).variant);

    expect((await call(split, { method: "PUT", params: at({ reason: "breakdown" }), body: { weights: [{ variant: "A", weight: 0 }, { variant: "B", weight: 0 }] } })).status).toBe(400);
    expect((await call(split, { method: "PUT", params: at({ reason: "breakdown" }), body: { weights: [{ variant: "A", weight: 1 }] } })).status).toBe(400);
    expect((await call(split, { method: "PUT", params: at({ reason: "breakdown" }), body: { weights: [{ variant: "A", weight: 1 }, { variant: "C", weight: 1 }] } })).status).toBe(404);

    expect((await call(remove, { method: "DELETE", params: at({ reason: "breakdown", variant: "A" }) })).status).toBe(409);
    const removed = await call(remove, { method: "DELETE", params: at({ reason: "breakdown", variant: "B" }) });
    expect(removed.status).toBe(200);
    expect(removed.body.variants.map((v: { variant: string; weight: number }) => [v.variant, v.weight])).toEqual([["A", 50]]);
    expect((await call(remove, { method: "DELETE", params: at({ reason: "breakdown", variant: "B" }) })).status).toBe(404);
  });

  it("gives A the traffic back when the only variant with any is removed", async () => {
    await call(addVariant, { params: at({ reason: "other" }) });
    await call(split, { method: "PUT", params: at({ reason: "other" }), body: { weights: [{ variant: "A", weight: 0 }, { variant: "B", weight: 1 }] } });
    expect((await reasonContent("other", "x")).variant).toBe("B");
    const res = await call(remove, { method: "DELETE", params: at({ reason: "other", variant: "B" }) });
    expect(res.body.variants).toEqual([expect.objectContaining({ variant: "A", weight: 1, share: 100 })]);
    expect((await reasonContent("other", "x")).variant).toBe("A");
  });
});

describe("conversion by reason", () => {
  it("counts offers, page views, joined there and then, thinking about it and joined later, by reason and variant", async () => {
    const e = await makeEngineer({ tradingName: "Ash Gas" });
    const test = await makeEngineer({ tradingName: "Test Co" });
    await prisma.adminTestMark.create({ data: { subjectType: "engineer", subjectId: test.id, adminId: "adm", adminName: "Matt" } });
    const base = new Date("2026-11-01T10:00:00Z");
    let n = 0;
    const offer = async (opts: { reason: string; variant?: string; channel: string; engineerId?: string; opened?: boolean; activatedAfterHours?: number | null; plan?: boolean; at?: Date }) => {
      const createdAt = opts.at ?? new Date(base.getTime() + n++ * 60_000);
      let planId: string | null = null;
      if (opts.plan !== false) {
        const engineerId = opts.engineerId ?? e.id;
        const c = await makeCustomer(engineerId);
        const activatedAt = opts.activatedAfterHours == null ? null : new Date(createdAt.getTime() + opts.activatedAfterHours * HOUR);
        const p = await makePlan(engineerId, c.id, { status: activatedAt ? "ACTIVE" : "PENDING", activatedAt, linkOpenedAt: opts.opened || activatedAt ? createdAt : null, visitReason: opts.reason, visitVariant: opts.variant ?? "A" });
        planId = p.id;
      }
      await prisma.offerSession.create({ data: { token: `t${n}-${Math.random()}`, engineerId: opts.engineerId ?? e.id, reason: opts.reason, variant: opts.variant ?? "A", channel: opts.channel, planId, createdAt } });
    };
    await offer({ reason: "new_boiler", channel: "show", activatedAfterHours: 0.2 });
    await offer({ reason: "new_boiler", channel: "show", activatedAfterHours: null });
    await offer({ reason: "new_boiler", channel: "sms", opened: false, activatedAfterHours: null });
    await offer({ reason: "new_boiler", channel: "sms", opened: true, activatedAfterHours: 50 });
    await offer({ reason: "new_boiler", variant: "B", channel: "whatsapp", opened: true, activatedAfterHours: null });
    await offer({ reason: "breakdown", channel: "show", plan: false });
    await offer({ reason: "new_boiler", channel: "show", engineerId: test.id, activatedAfterHours: 0.1 });
    await offer({ reason: "new_boiler", channel: "show", at: new Date("2026-12-01T10:00:00Z"), activatedAfterHours: 0.1 });

    const res = await call(report, { query: { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z" } });
    expect(res.status).toBe(200);
    expect(res.body.joinedNowHours).toBe(24);
    expect(res.body.rows).toEqual([
      { reason: "new_boiler", label: "New boiler fitted", variant: "A", offers: 4, viewed: 3, joined: 1, thinking: 2, joinedLater: 1 },
      { reason: "new_boiler", label: "New boiler fitted", variant: "B", offers: 1, viewed: 1, joined: 0, thinking: 1, joinedLater: 0 },
      { reason: "breakdown", label: "Breakdown / repair", variant: "A", offers: 1, viewed: 1, joined: 0, thinking: 1, joinedLater: 0 },
    ]);
    expect((await call(report, { query: { from: "2026-11-01", to: "2026-12-01" } })).status).toBe(400);
  });
});
