import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { GET as reviews } from "@/app/api/admin/v1/engineers/[engineerId]/reviews/route";
import { POST as report } from "@/app/api/admin/v1/engineers/[engineerId]/reviews/[ratingId]/report/route";
import { GET as months } from "@/app/api/admin/v1/engineers/[engineerId]/statements/route";
import { GET as statement } from "@/app/api/admin/v1/engineers/[engineerId]/statements/[month]/route";
import { computeApplicationFeePence } from "@/lib/stripe";
import { call, resetDb, SUPER_ADMIN, withPermissions } from "./helpers";
import { makeCustomer, makeEngineer, makePlan } from "./factories";

beforeEach(resetDb);

const at = <R extends Record<string, string>>(engineerId: string, rest: R = {} as R) => ({ params: { engineerId, ...rest } });
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));
let tokens = 0;
const rating = (engineerId: string, planId: string | null, data: Record<string, unknown>) =>
  prisma.rating.create({ data: { engineerId, planId, requestToken: `tok-${++tokens}`, ...data } });

async function engineerWithReviews() {
  const e = await makeEngineer({ tradingName: "Ash Gas" });
  const other = await makeEngineer({ tradingName: "Birch Heating" });
  const c1 = await makeCustomer(e.id, { firstName: "Sarah", lastName: "Jones" });
  const c2 = await makeCustomer(e.id, { firstName: "Tom", lastName: "Reid" });
  const p1 = await makePlan(e.id, c1.id);
  const p2 = await makePlan(e.id, c2.id);
  const five = await rating(e.id, p1.id, { stars: 5, comment: "On time and tidy.", customerName: "Sarah J.", ratedAt: day(2026, 10, 20) });
  const two = await rating(e.id, p2.id, { stars: 2, comment: "Late.", customerName: "Tom R.", ratedAt: day(2026, 10, 25), reply: "Sorry, the van broke down.", repliedAt: day(2026, 10, 26) });
  const gone = await rating(e.id, null, { source: "offer", stars: 1, comment: "Rude words", customerName: "Anon", ratedAt: day(2026, 10, 1), removedAt: day(2026, 10, 2), removedReason: "Abuse" });
  await rating(e.id, p1.id, { stars: null, ratedAt: null });
  const theirs = await rating(other.id, null, { source: "offer", stars: 4, customerName: "Pat K.", ratedAt: day(2026, 10, 22) });
  return { e, other, p1, p2, five, two, gone, theirs };
}

describe("reviews per installer", () => {
  it("lists every review newest first, removed ones marked, with the summary the record shows", async () => {
    const { e, five, two, gone } = await engineerWithReviews();
    const res = await call(reviews, at(e.id));
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: { id: string }) => r.id)).toEqual([two.id, five.id, gone.id]);
    expect(res.body.items[0]).toMatchObject({ stars: 2, low: true, customer: "Tom R.", source: "service", plan: { ref: expect.stringMatching(/^TS-P/) }, reply: { text: "Sorry, the van broke down." }, removed: null });
    expect(res.body.items[1]).toMatchObject({ stars: 5, low: false, comment: "On time and tidy.", reply: null });
    expect(res.body.items[2]).toMatchObject({ source: "offer", plan: null, removed: { reason: "Abuse" } });
    expect(res.body.summary).toEqual({ published: 2, average: 3.5, removed: 1, awaiting: 1 });
  });

  it("is 404 for an engineer that isn't there, and needs engineers:read", async () => {
    const { e } = await engineerWithReviews();
    expect((await call(reviews, at("cm000000000000000000000000"))).status).toBe(404);
    expect((await call(reviews, { ...at(e.id), as: withPermissions("customers:read") })).status).toBe(403);
  });

  it("report abuse takes the review down the app's way, with the reason and who reported it", async () => {
    const { e, two } = await engineerWithReviews();
    const res = await call(report, { ...at(e.id, { ratingId: two.id }), body: { reason: "Names the customer's neighbour and swears at him" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: two.id, removed: true });
    const row = await prisma.rating.findUniqueOrThrow({ where: { id: two.id } });
    expect(row.removedAt).toBeInstanceOf(Date);
    expect(row.removedReason).toBe("Names the customer's neighbour and swears at him");
    const events = await prisma.event.findMany({ where: { name: { in: ["rating_removed", "review_reported"] } }, orderBy: { name: "asc" } });
    expect(events.map((ev) => [ev.name, ev.actorType, (ev.meta as { removedBy?: string; engineerId?: string }).engineerId])).toEqual([
      ["rating_removed", "SYSTEM", e.id],
      ["review_reported", "ADMIN", e.id],
    ]);
    expect((events[0]!.meta as { removedBy: string }).removedBy).toBe(`${SUPER_ADMIN.name} (admin)`);
    expect((events[1]!.meta as { reason: string; ratingId: string; stars: number })).toMatchObject({ ratingId: two.id, stars: 2, reason: "Names the customer's neighbour and swears at him" });
    const after = await call(reviews, at(e.id));
    expect(after.body.items.find((r: { id: string }) => r.id === two.id).removed).toMatchObject({ reason: "Names the customer's neighbour and swears at him" });
    expect(after.body.summary).toEqual({ published: 1, average: 5, removed: 2, awaiting: 1 });
  });

  it("refuses a second report (409), another engineer's review (404), no reason (400) and the wrong permission (403)", async () => {
    const { e, gone, theirs, five } = await engineerWithReviews();
    expect((await call(report, { ...at(e.id, { ratingId: gone.id }), body: { reason: "Already gone, reporting again" } })).status).toBe(409);
    expect((await call(report, { ...at(e.id, { ratingId: theirs.id }), body: { reason: "Not this engineer's review" } })).status).toBe(404);
    expect((await call(report, { ...at(e.id, { ratingId: five.id }), body: { reason: "" } })).status).toBe(400);
    expect((await call(report, { ...at(e.id, { ratingId: five.id }), body: { reason: "Support can't take reviews down" }, as: withPermissions("engineers:read", "engineers:edit") })).status).toBe(403);
    expect((await prisma.rating.findUniqueOrThrow({ where: { id: five.id } })).removedAt).toBeNull();
  });
});

describe("fee statements", () => {
  async function engineerWithCollections() {
    const e = await makeEngineer({ tradingName: "Ash Gas", legalName: "Ash Gas Ltd", packAddress: "1 High Street\nHolmfirth\nHD9 2TT" });
    const other = await makeEngineer();
    const c = await makeCustomer(e.id, { firstName: "Sarah", lastName: "Jones" });
    const p = await makePlan(e.id, c.id);
    const theirs = await makePlan(other.id, (await makeCustomer(other.id)).id);
    const paid = (planId: string, engineerId: string, ts: Date, amountPence: number) =>
      prisma.event.create({ data: { name: "payment_confirmed", actorType: "SYSTEM", ts, meta: { planId, engineerId, amountPence, invoiceId: `in_${ts.getTime()}` } } });
    await paid(p.id, e.id, day(2026, 9, 5), 1500);
    await paid(p.id, e.id, day(2026, 10, 5), 2400);
    await paid(p.id, e.id, day(2026, 10, 20), 1500);
    await paid(theirs.id, other.id, day(2026, 10, 7), 9900);
    await prisma.event.create({ data: { name: "yearly_refund", actorType: "SYSTEM", ts: day(2026, 11, 10), meta: { planId: p.id, amountPence: 1000 } } });
    return { e, other, p };
  }

  it("lists the months with a statement, newest first, with the app's totals", async () => {
    const { e } = await engineerWithCollections();
    const res = await call(months, at(e.id));
    expect(res.status).toBe(200);
    const fee = computeApplicationFeePence;
    expect(res.body.items).toEqual([
      { month: "2026-11", label: "November 2026", number: expect.stringMatching(/^TS-202611-/), collections: 0, refunds: 1, collectedPence: 0, feePence: 0, feeRefundedPence: 200, netFeePence: -200, toYouPence: -800 },
      { month: "2026-10", label: "October 2026", number: expect.stringMatching(/^TS-202610-/), collections: 2, refunds: 0, collectedPence: 3900, feePence: fee(2400) + fee(1500), feeRefundedPence: 0, netFeePence: fee(2400) + fee(1500), toYouPence: 3900 - fee(2400) - fee(1500) },
      { month: "2026-09", label: "September 2026", number: expect.stringMatching(/^TS-202609-/), collections: 1, refunds: 0, collectedPence: 1500, feePence: fee(1500), feeRefundedPence: 0, netFeePence: fee(1500), toYouPence: 1500 - fee(1500) },
    ]);
  });

  it("reads one month as the installer's statement, and refuses a month not written YYYY-MM", async () => {
    const { e } = await engineerWithCollections();
    const res = await call(statement, at(e.id, { month: "2026-10" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      month: "2026-10",
      label: "October 2026",
      engineer: { name: "Ash Gas Ltd", address: ["1 High Street", "Holmfirth", "HD9 2TT"] },
      lines: [
        { date: "5 Oct 2026", customer: "Sarah Jones", planRef: expect.stringMatching(/^TS-P/), collectedPence: 2400, feePence: computeApplicationFeePence(2400) },
        { date: "20 Oct 2026", customer: "Sarah Jones", collectedPence: 1500, feePence: computeApplicationFeePence(1500) },
      ],
      refunds: [],
      totals: { collectedPence: 3900 },
    });
    expect((await call(statement, at(e.id, { month: "October" }))).status).toBe(400);
    expect((await call(statement, at("cm000000000000000000000000", { month: "2026-10" }))).status).toBe(404);
    expect((await call(months, { ...at(e.id), as: withPermissions("customers:read") })).status).toBe(403);
  });

  it("an engineer with no collections has no statements", async () => {
    const e = await makeEngineer();
    expect((await call(months, at(e.id))).body).toEqual({ items: [] });
  });
});
