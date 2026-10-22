import { describe, expect, it } from "vitest";
import {
  cancelRatePercent,
  installerFlags,
  isKept,
  parseSettingValue,
  qualityLabel,
  rescueSummary,
  topReason,
} from "@/lib/admin-metrics";

describe("admin retention maths", () => {
  it("cancel rate is cancelled over live + cancelled, one decimal", () => {
    expect(cancelRatePercent(0, 0)).toBeNull();
    expect(cancelRatePercent(0, 64)).toBe(0);
    expect(cancelRatePercent(2, 62)).toBe(3.1); // 2 / 64
    expect(cancelRatePercent(1, 0)).toBe(100);
  });

  it("top reason is the most common, ties to the most recent", () => {
    const d = (n: number) => new Date(2026, 9, n);
    expect(topReason([])).toBeNull();
    expect(
      topReason([
        { reason: "moving", at: d(1) },
        { reason: "too_expensive", at: d(2) },
        { reason: "moving", at: d(3) },
      ]),
    ).toBe("moving");
    expect(
      topReason([
        { reason: "moving", at: d(1) },
        { reason: "too_expensive", at: d(5) },
      ]),
    ).toBe("too_expensive");
  });

  it("saved, paused and switched count as kept", () => {
    expect(["saved", "paused", "downgraded"].every(isKept)).toBe(true);
    expect(isKept("cancelled")).toBe(false);
    expect(isKept("pending")).toBe(false);
  });

  it("counts rescued of failed per plan, once each", () => {
    expect(rescueSummary(["a", "b", "c", "a"], ["a", "b"], ["c"])).toEqual({ rescued: 2, lost: 1, failed: 3 });
    // A rescue whose failure was before the window still counts as failed.
    expect(rescueSummary([], ["x"], [])).toEqual({ rescued: 1, lost: 0, failed: 1 });
    // Rescued wins over lost for the same plan.
    expect(rescueSummary(["p"], ["p"], ["p"])).toEqual({ rescued: 1, lost: 0, failed: 1 });
  });

  it("flags high cancel rates and low sticker stock against the admin thresholds", () => {
    const base = { cancelThreshold: 6, stickerThreshold: 5, stickersAllocated: 25 };
    expect(installerFlags({ ...base, cancelRate: 9.4, stickersLeft: 24 })).toEqual({ highCancel: true, lowStickers: false });
    expect(installerFlags({ ...base, cancelRate: 6, stickersLeft: 2 })).toEqual({ highCancel: false, lowStickers: true });
    expect(installerFlags({ ...base, cancelRate: null, stickersLeft: 5 })).toEqual({ highCancel: false, lowStickers: true });
    // Never sent stickers: nothing to top up yet.
    expect(installerFlags({ ...base, stickersAllocated: 0, cancelRate: null, stickersLeft: 0 }).lowStickers).toBe(false);
  });

  it("puts rating and cancellation in one quality label", () => {
    expect(qualityLabel({ highCancel: false, average: 4.9, count: 38, lowRatings: 0 })).toBe("good");
    expect(qualityLabel({ highCancel: false, average: 4.8, count: 21, lowRatings: 1 })).toBe("watch");
    expect(qualityLabel({ highCancel: true, average: 4.9, count: 38, lowRatings: 0 })).toBe("step in");
    expect(qualityLabel({ highCancel: false, average: 3.5, count: 4, lowRatings: 0 })).toBe("step in");
    expect(qualityLabel({ highCancel: false, average: 2, count: 1, lowRatings: 1 })).toBe("watch");
  });

  it("only accepts whole-number settings", () => {
    expect(parseSettingValue(" 6 ")).toBe("6");
    expect(parseSettingValue("06")).toBe("6");
    expect(parseSettingValue("6.5")).toBeNull();
    expect(parseSettingValue("-1")).toBeNull();
    expect(parseSettingValue("")).toBeNull();
    expect(parseSettingValue("5000")).toBeNull();
  });
});
