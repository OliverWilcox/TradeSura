import { describe, expect, it } from "vitest";
import { FOUNDING_CLOCK_DAYS, allocateFounding, type FoundingCandidate } from "@/lib/admin/founding";

// Engineer record 3, with the defaults agreed on 31 Oct: three spots a town in
// order of verification, a 60-day clock from getting the spot, kept by a
// first plan live in time, otherwise released to the next in line.

const DAY = 86_400_000;
const start = new Date("2026-01-01T09:00:00Z");
const day = (n: number) => new Date(start.getTime() + n * DAY);
const engineer = (id: string, verifiedDay: number, planLiveDay: number | null = null): FoundingCandidate => ({
  id,
  verifiedAt: day(verifiedDay),
  planLive: planLiveDay !== null,
  planLiveAt: planLiveDay === null ? null : day(planLiveDay),
});

describe("allocateFounding", () => {
  it("gives three spots in order of verification; the fourth waits", () => {
    const spots = allocateFounding([engineer("d", 4), engineer("b", 2), engineer("a", 1), engineer("c", 3)], day(10));
    expect(spots.get("a")).toMatchObject({ state: "top_spot", position: 1, since: day(1), clockEndsAt: day(1 + FOUNDING_CLOCK_DAYS), kept: false });
    expect(spots.get("b")).toMatchObject({ state: "badge", position: 2 });
    expect(spots.get("c")).toMatchObject({ state: "badge", position: 3 });
    expect(spots.get("d")).toEqual({ state: "waiting", place: 1 });
  });

  it("releases a spot when the clock runs out, and the next in line starts a clock of their own", () => {
    const spots = allocateFounding([engineer("a", 1), engineer("b", 2, 20), engineer("c", 3, 30), engineer("d", 4)], day(70));
    expect(spots.get("a")).toEqual({ state: "released", since: day(1), releasedAt: day(61) });
    expect(spots.get("b")).toMatchObject({ state: "top_spot", position: 1, kept: true });
    expect(spots.get("c")).toMatchObject({ state: "badge", position: 2, kept: true });
    expect(spots.get("d")).toMatchObject({ state: "badge", position: 3, since: day(61), clockEndsAt: day(121), kept: false });
  });

  it("keeps a spot whose first plan went live in time, however long ago", () => {
    expect(allocateFounding([engineer("a", 1, 59)], day(400)).get("a")).toMatchObject({ state: "top_spot", kept: true });
  });

  it("releases a spot whose first plan went live too late", () => {
    expect(allocateFounding([engineer("a", 1, 61)], day(70)).get("a")).toMatchObject({ state: "released", releasedAt: day(61) });
  });

  it("keeps a spot for a plan that went live before the app logged dates", () => {
    expect(allocateFounding([{ id: "a", verifiedAt: day(1), planLive: true, planLiveAt: null }], day(100)).get("a")).toMatchObject({ state: "top_spot", kept: true });
  });

  it("leaves out anyone verified after the moment asked about", () => {
    expect(allocateFounding([engineer("a", 5)], day(1)).has("a")).toBe(false);
  });
});
