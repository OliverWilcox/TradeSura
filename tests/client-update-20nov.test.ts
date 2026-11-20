import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { nationalNumber, screenedNumber } from "@/lib/admin/tps";
import { reminderText } from "@/lib/admin/letters";
import { recheckReasonOf } from "@/lib/safety-complaints";
import { engineerFunnelOf, ENGINEER_FUNNEL_STEPS } from "@/lib/admin/engineer-funnel";
import { photoSourceOf } from "@/lib/gas-safe-card";
import { cardChecked } from "@/components/engineer-page";

describe("TPS numbers", () => {
  it("reads the forms a screening file uses and writes the national form", () => {
    for (const raw of ["07700 900123", "+44 7700 900123", "447700900123", "7700900123", "'07700900123'", "07700-900-123"]) {
      expect(screenedNumber(raw), raw).toBe("+447700900123");
    }
    for (const raw of ["", "12345", "not a number", "0770090012"]) expect(screenedNumber(raw), raw).toBeNull();
    expect(nationalNumber("+447700900123")).toBe("07700900123");
  });
});

describe("the reminder text", () => {
  const link = "https://tradesura.com/c/ASH7K3Q/app?t=x";
  it("names the Founding spot until the reservation date, then just the account", () => {
    const deadline = new Date("2026-12-01T23:59:59Z");
    expect(reminderText({ code: "ASH7K3Q", town: "Leeds", deadline, link }, new Date("2026-11-20T12:00:00Z"))).toBe(
      `TradeSura: your Founding Member spot in Leeds is held until 1 December 2026. Finish setting up with your code ASH7K3Q: ${link} Reply STOP to opt out.`,
    );
    expect(reminderText({ code: "ASH7K3Q", town: "Leeds", deadline, link }, new Date("2026-12-02T12:00:00Z"))).toBe(
      `TradeSura: your account is waiting. Finish setting up with your code ASH7K3Q: ${link} Reply STOP to opt out.`,
    );
    expect(reminderText({ code: "ASH7K3Q", town: null, deadline, link }, new Date("2026-11-20T12:00:00Z"))).toContain("your account is waiting");
  });
});

describe("a safety complaint's re-check reason", () => {
  it("says where it came from and keeps it short", () => {
    expect(recheckReasonOf("  Flue   left loose \n by the boiler ")).toBe("Safety complaint from a homeowner: Flue left loose by the boiler");
    const long = recheckReasonOf("x".repeat(1000));
    expect(long.length).toBeLessThan(360);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("the funnel from sign-ups", () => {
  it("leaves the letter steps out and starts at sign-ups", () => {
    const at = new Date("2026-11-01T10:00:00Z");
    const item = Object.fromEntries(ENGINEER_FUNNEL_STEPS.map((s) => [s.key, { reached: false, at: null }])) as Parameters<typeof engineerFunnelOf>[0][number];
    const a = { ...item, letters_posted: { reached: true, at }, signed_up: { reached: true, at }, card_uploaded: { reached: true, at: new Date("2026-11-03T10:00:00Z") } };
    const b = { ...item, letters_posted: { reached: true, at }, signed_up: { reached: true, at } };
    const steps = engineerFunnelOf([a, b], "signups");
    const by = new Map(steps.map((s) => [s.key, s]));
    for (const key of ["letters_posted", "claim_scans", "details_completed", "store_opened", "store_downloads"] as const) expect(by.get(key)).toMatchObject({ count: null, noData: "Only letters have this step" });
    expect(by.get("signed_up")).toMatchObject({ label: "Sign-ups", count: 2, ofStart: 1, comparedWith: null, note: null });
    expect(by.get("card_uploaded")).toMatchObject({ count: 1, ofStart: 0.5, fromPrevious: 0.5, comparedWith: "signed_up", medianDaysFromPrevious: 2 });
  });
});

describe("photo sources and the public page", () => {
  it("keeps only the two sources the app sends", () => {
    expect([photoSourceOf("camera"), photoSourceOf("library"), photoSourceOf("gallery"), photoSourceOf(undefined)]).toEqual(["camera", "library", null, null]);
  });

  it("calls an engineer Gas Safe registered only while their card check stands", () => {
    const live = { gasSafeVerifiedAt: new Date(), pausedAt: null, bannedAt: null, leftAt: null };
    expect(cardChecked(live)).toBe(true);
    expect(cardChecked({ ...live, gasSafeVerifiedAt: null })).toBe(false);
    expect(cardChecked({ ...live, pausedAt: new Date() })).toBe(false);
    expect(cardChecked({ ...live, bannedAt: new Date() })).toBe(false);
    expect(cardChecked({ ...live, leftAt: new Date() })).toBe(false);
  });
});
