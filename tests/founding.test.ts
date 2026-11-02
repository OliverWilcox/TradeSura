// 30 Oct update §1 and §10 — the claim page helpers, the Founding badge
// deadline, top-3 spots per town (award, 60-day release, reminders) and the
// town page order.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/push", () => ({ sendPushNotification: vi.fn() }));

import {
  accountComplete,
  claimedInTime,
  daysLeft,
  foundingCountLine,
  foundingDeadlineFrom,
  planTownSpots,
  reminderDue,
  townPageOrder,
  type Holder,
  type TownRow,
} from "@/lib/founding";
import { addressError, addressText, claimText, parseAddressText, platformOf, storeUrl } from "@/lib/claim";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date("2027-01-10T09:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

const holder = (id: string, heldFromDays: number, extra: Partial<Holder> = {}): Holder => ({
  spotId: `s-${id}`,
  engineerId: id,
  heldFrom: at(heldFromDays),
  hasCustomer: false,
  stillHere: true,
  ...extra,
});

describe("top 3 spots per town", () => {
  it("the first 3 to complete get the spots, in completion order", () => {
    const plan = planTownSpots(
      [],
      [
        { engineerId: "c", completedAt: at(3) },
        { engineerId: "a", completedAt: at(1) },
        { engineerId: "d", completedAt: at(4) },
        { engineerId: "b", completedAt: at(2) },
      ],
      at(5),
    );
    expect(plan.award).toEqual(["a", "b", "c"]);
    expect(plan.release).toEqual([]);
  });

  it("only fills what's free", () => {
    const plan = planTownSpots([holder("a", 0), holder("b", 0)], [{ engineerId: "c", completedAt: at(1) }, { engineerId: "d", completedAt: at(2) }], at(5));
    expect(plan.award).toEqual(["c"]);
  });

  it("releases a spot after 60 days with no customer, and passes it on", () => {
    const plan = planTownSpots(
      [holder("a", 0), holder("b", 0, { hasCustomer: true }), holder("c", 10)],
      [{ engineerId: "d", completedAt: at(5) }],
      at(60),
    );
    expect(plan.release).toEqual([{ spotId: "s-a", engineerId: "a", reason: "no_customer" }]);
    expect(plan.award).toEqual(["d"]);
  });

  it("keeps the spot on day 59, and for good once a customer has signed", () => {
    expect(planTownSpots([holder("a", 0)], [], at(59.9)).release).toEqual([]);
    expect(planTownSpots([holder("a", 0, { hasCustomer: true })], [], at(400)).release).toEqual([]);
  });

  it("frees the spot of someone who moved town or closed their account", () => {
    const plan = planTownSpots([holder("a", 0, { stillHere: false })], [{ engineerId: "b", completedAt: at(1) }], at(2));
    expect(plan.release[0]).toMatchObject({ engineerId: "a", reason: "left_town" });
    expect(plan.award).toEqual(["b"]);
  });

  it("counts the days left and sends each reminder at 30, 14, 7 and 2 days left", () => {
    expect(daysLeft(t0, at(0))).toBe(60);
    expect(daysLeft(t0, at(59.5))).toBe(1);
    expect(daysLeft(t0, at(61))).toBe(0);
    expect(reminderDue(t0, at(10))).toBeNull(); // 50 left
    expect(reminderDue(t0, at(30))).toBe(30);
    expect(reminderDue(t0, at(40))).toBe(30); // 20 left: still the 30-day one
    expect(reminderDue(t0, at(46))).toBe(14);
    expect(reminderDue(t0, at(53))).toBe(7);
    expect(reminderDue(t0, at(58))).toBe(2);
    expect(reminderDue(t0, at(60))).toBeNull();
  });
});

describe("Founding badge", () => {
  it("uses the admin's letter date (end of that UK day), else 28 days from loading", () => {
    const loaded = new Date("2026-11-01T10:00:00Z");
    expect(foundingDeadlineFrom("2026-12-01", loaded).toISOString()).toBe("2026-12-01T23:59:59.000Z"); // GMT
    expect(foundingDeadlineFrom("2027-06-01", loaded).toISOString()).toBe("2027-06-01T22:59:59.000Z"); // BST
    expect(foundingDeadlineFrom(null, loaded).toISOString()).toBe("2026-11-29T10:00:00.000Z");
    expect(foundingDeadlineFrom("not a date", loaded).toISOString()).toBe("2026-11-29T10:00:00.000Z");
  });

  it("counts a claim (or, without one, the sign-up) made by the letter date", () => {
    const deadline = new Date("2026-12-01T23:59:59Z");
    expect(claimedInTime({ claimedAt: new Date("2026-11-30T12:00:00Z"), redeemedAt: new Date("2026-12-09T12:00:00Z") }, deadline)).toBe(true);
    expect(claimedInTime({ claimedAt: null, redeemedAt: new Date("2026-12-01T20:00:00Z") }, deadline)).toBe(true);
    expect(claimedInTime({ claimedAt: null, redeemedAt: new Date("2026-12-02T08:00:00Z") }, deadline)).toBe(false);
    expect(claimedInTime({ claimedAt: null, redeemedAt: null }, deadline)).toBe(false);
  });

  it("an account is complete with the badge, a live plan and payments on", () => {
    const base = {
      gasSafeVerifiedAt: new Date(),
      stripeChargesEnabled: true,
      liveTiers: 1,
      pausedAt: null,
      bannedAt: null,
      deletedAt: null,
      leftAt: null,
      ownerId: null,
    };
    expect(accountComplete(base)).toBe(true);
    expect(accountComplete({ ...base, stripeChargesEnabled: false })).toBe(false);
    expect(accountComplete({ ...base, liveTiers: 0 })).toBe(false);
    expect(accountComplete({ ...base, gasSafeVerifiedAt: null })).toBe(false);
    expect(accountComplete({ ...base, ownerId: "owner" })).toBe(false);
  });
});

describe("town page order", () => {
  const row = (name: string, extra: Partial<TownRow> = {}): TownRow => ({
    id: name,
    name,
    topSpotFrom: null,
    payingCustomers: 0,
    ratingCount: 0,
    ratingAverage: null,
    lastRatedAt: null,
    ...extra,
  });

  it("Founding top 3 › most active locally › everyone else by reviews", () => {
    const rows = [
      row("Reviews only", { ratingCount: 30, ratingAverage: 4.9 }),
      row("Busy", { payingCustomers: 40, ratingCount: 2, ratingAverage: 4 }),
      row("Top spot later", { topSpotFrom: at(5) }),
      row("Quiet"),
      row("Top spot first", { topSpotFrom: at(1) }),
      row("Less busy", { payingCustomers: 3, ratingCount: 50, ratingAverage: 5 }),
    ];
    expect(townPageOrder(rows).map((r) => r.name)).toEqual([
      "Top spot first",
      "Top spot later",
      "Busy",
      "Less busy",
      "Reviews only",
      "Quiet",
    ]);
  });

  it("settles ties by review score: number, then average, then recency", () => {
    const rows = [
      row("Older", { payingCustomers: 5, ratingCount: 4, ratingAverage: 4.5, lastRatedAt: at(1) }),
      row("Newer", { payingCustomers: 5, ratingCount: 4, ratingAverage: 4.5, lastRatedAt: at(9) }),
      row("Fewer", { payingCustomers: 5, ratingCount: 3, ratingAverage: 5, lastRatedAt: at(10) }),
    ];
    expect(townPageOrder(rows).map((r) => r.name)).toEqual(["Newer", "Older", "Fewer"]);
  });
});

describe("claim page", () => {
  const deadline = new Date("2026-12-01T23:59:59Z");
  it("says how many top spots are left, or what's still on offer", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(foundingCountLine({ town: "Holmfirth", spotsLeft: 2, deadline, now })).toBe("Top spots left in Holmfirth: 2 of 3");
    expect(foundingCountLine({ town: "Holmfirth", spotsLeft: 0, deadline, now })).toBe(
      "Holmfirth's top 3 spots have gone, but you can still claim your Founding Member badge until 1 December 2026.",
    );
    expect(foundingCountLine({ town: "Holmfirth", spotsLeft: 3, deadline, now: new Date("2026-12-05T12:00:00Z") })).toBe(
      "Your Founding reservation ended on 1 December 2026, but your free account is still waiting.",
    );
  });

  it("checks addresses and stores them like the pack address", () => {
    expect(addressError({ line1: "4 Mill Lane", town: "Holmfirth", postcode: "HD9 2AB" }, "trading address")).toBeNull();
    expect(addressError({ line1: "", town: "Holmfirth", postcode: "HD9 2AB" }, "trading address")).toMatch(/first line/);
    expect(addressError({ line1: "4 Mill Lane", town: "Holmfirth", postcode: "12345" }, "trading address")).toMatch(/postcode/);
    const text = addressText({ line1: " 4 Mill Lane ", town: "Holmfirth", postcode: "hd9 2ab" });
    expect(text).toBe("4 Mill Lane\nHolmfirth\nHD9 2AB");
    expect(parseAddressText(text)).toEqual({ line1: "4 Mill Lane", town: "Holmfirth", postcode: "HD9 2AB" });
  });

  it("texts the code with the personal link", () => {
    expect(claimText("TS-48217", "https://tradesura.com/c/TS-48217/app")).toBe(
      "TradeSura: your claim code is TS-48217. Tap here once the app's installed: https://tradesura.com/c/TS-48217/app",
    );
  });

  it("picks the store by phone, carrying the code through Android's install referrer", () => {
    expect(platformOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(platformOf("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("android");
    expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("desktop");
    expect(storeUrl("android", "TS-48217")).toContain("referrer=claim%3DTS-48217");
    expect(storeUrl("ios", "TS-48217")).toMatch(/^https:\/\/apps\.apple\.com\//);
  });
});
