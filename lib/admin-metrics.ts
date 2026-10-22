// Section 10 — the admin retention view's maths, kept pure so it's tested
// (tests/admin-metrics.test.ts). The page does the queries.

export const CANCEL_RATE_FLAG_KEY = "cancel_rate_flag_percent";
export const STICKER_LOW_STOCK_KEY = "sticker_low_stock";
export const DEFAULT_CANCEL_RATE_FLAG = 6;
export const DEFAULT_STICKER_LOW_STOCK = 5;

export const EDITABLE_SETTINGS: { key: string; label: string; fallback: number }[] = [
  { key: CANCEL_RATE_FLAG_KEY, label: "Flag cancel rate above (%)", fallback: DEFAULT_CANCEL_RATE_FLAG },
  { key: "rating_new_member_threshold", label: "\"New to TradeSura\" until this many ratings", fallback: 3 },
  { key: STICKER_LOW_STOCK_KEY, label: "Flag sticker stock at or below", fallback: DEFAULT_STICKER_LOW_STOCK },
];

/** Settings are whole numbers 0–1000; anything else is rejected. */
export function parseSettingValue(raw: string): string | null {
  const t = raw.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  return n <= 1000 ? String(n) : null;
}

/**
 * Cancellations over the window as a share of the plans the installer had
 * in it (still live + cancelled). One decimal place; null with no plans.
 */
export function cancelRatePercent(cancelled: number, live: number): number | null {
  const base = live + cancelled;
  if (base <= 0) return null;
  return Math.round((cancelled / base) * 1000) / 10;
}

/** The most common reason; ties go to the most recent of the tied reasons. */
export function topReason(reasons: { reason: string; at: Date }[]): string | null {
  if (reasons.length === 0) return null;
  const tally = new Map<string, { n: number; last: number }>();
  for (const r of reasons) {
    const t = tally.get(r.reason) ?? { n: 0, last: 0 };
    t.n += 1;
    t.last = Math.max(t.last, r.at.getTime());
    tally.set(r.reason, t);
  }
  return [...tally.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last - a[1].last)[0][0];
}

/** Request outcomes that count as kept: saved, paused or switched plan. */
export const KEPT_OUTCOMES = ["saved", "paused", "downgraded"] as const;

export function isKept(outcome: string): boolean {
  return (KEPT_OUTCOMES as readonly string[]).includes(outcome);
}

/**
 * "23 of 29" failed payments rescued. A plan that failed and was rescued
 * counts once; rescued can't exceed failed (a rescue for a failure from
 * before the window still counts it as failed).
 */
export function rescueSummary(failedPlanIds: string[], rescuedPlanIds: string[], lostPlanIds: string[]) {
  const rescued = new Set(rescuedPlanIds);
  const lost = new Set([...lostPlanIds].filter((id) => !rescued.has(id)));
  const failed = new Set([...failedPlanIds, ...rescued, ...lost]);
  return { rescued: rescued.size, lost: lost.size, failed: failed.size };
}

export type InstallerFlags = { highCancel: boolean; lowStickers: boolean };

export function installerFlags(opts: {
  cancelRate: number | null;
  stickersLeft: number;
  cancelThreshold: number;
  stickerThreshold: number;
  /** Only flag stock for installers who've been sent stickers. */
  stickersAllocated: number;
}): InstallerFlags {
  return {
    highCancel: opts.cancelRate !== null && opts.cancelRate > opts.cancelThreshold,
    // Same rule as the installer's own low-stock prompt (lib/stickers.ts).
    lowStickers: opts.stickersAllocated > 0 && opts.stickersLeft <= opts.stickerThreshold,
  };
}

/**
 * Quality in one view: rating and cancellation together. "step in" when the
 * cancel rate is flagged or the rating is poor (below 4 from 3+ ratings);
 * "watch" with any low (1–2 star) rating; otherwise "good".
 */
export function qualityLabel(opts: {
  highCancel: boolean;
  average: number | null;
  count: number;
  lowRatings: number;
}): "good" | "watch" | "step in" {
  if (opts.highCancel || (opts.average !== null && opts.count >= 3 && opts.average < 4)) return "step in";
  if (opts.lowRatings > 0) return "watch";
  return "good";
}
