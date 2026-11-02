import { Platform } from "react-native";
import * as StoreReview from "expo-store-review";
import { api, getRatingPrompted, msSinceTrouble, setRatingPrompted } from "@/lib/api";

// Matt, 30 Oct §8 — Apple's / Google's own rating prompt (it stays inside
// the app) at three happy moments: the "You're live" celebration after the
// Gas Safe check, the first customer, the first Friday payout. Shown 2–3
// seconds after the celebration, never behind a button, and never filtered
// by an "Are you happy?" question first. Skipped if they've just hit an
// error or opened support chat. The OS also decides whether to show it.
export type RatingMoment = "verified" | "first_customer" | "first_payout";

const AFTER_CELEBRATION_MS = 2500;
const QUIET_AFTER_TROUBLE_MS = 10 * 60 * 1000;

/**
 * Call when the celebration starts, with how long its animation runs. The
 * prompt comes 2.5 s after it finishes. Returns a cancel for when the screen
 * goes away first.
 */
export function askForRatingSoon(moment: RatingMoment, celebrationMs = 0): () => void {
  if (Platform.OS === "web") return () => {};
  const timer = setTimeout(() => {
    void ask(moment);
  }, celebrationMs + AFTER_CELEBRATION_MS);
  return () => clearTimeout(timer);
}

async function ask(moment: RatingMoment) {
  try {
    if (msSinceTrouble() < QUIET_AFTER_TROUBLE_MS) return;
    if (await getRatingPrompted(moment)) return;
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return;
    await setRatingPrompted(moment);
    await StoreReview.requestReview();
    api("/api/telemetry/rating", { method: "POST", body: JSON.stringify({ moment }) }).catch(() => {});
  } catch {
    // Best-effort: a prompt that can't show never gets in the way.
  }
}
