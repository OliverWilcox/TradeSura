import type { Href } from "expo-router";

// Build Review 3 — the offer lock. Engineers can build plans straight away,
// but real offers unlock only once TradeSura has verified their Gas Safe
// registration AND Stripe payments are set up. Until then offer buttons say
// why, in amber, with "Try it in demo mode". The server (app/api/offer) is
// the gate; this is the same rule for the screens.
export type OfferLock = {
  reason: string;
  cta: string;
  href: Href;
  /** Review 4 — what's still missing, so a card can name both. */
  needsGasSafe?: boolean;
  needsPayments?: boolean;
};

export function offerLock(me: {
  hasPlan?: boolean;
  gasSafeVerifiedAt?: string | null;
  stripeConnected?: boolean;
  role?: string;
} | null | undefined): OfferLock | null {
  if (!me?.hasPlan) {
    return { reason: "Build your first plan before you offer one.", cta: "Build my plan", href: "/plan-wizard" };
  }
  if (!me.gasSafeVerifiedAt && !me.stripeConnected && me.role !== "staff") {
    return {
      reason: "Unlocks when your Gas Safe check and payments are done.",
      cta: "Set up payments",
      href: "/get-paid",
      needsGasSafe: true,
      needsPayments: true,
    };
  }
  if (!me.gasSafeVerifiedAt) {
    return {
      needsGasSafe: true,
      reason: "Unlocks when your Gas Safe check is done (usually within 24 hours).",
      cta: "Check my status",
      href: "/more",
    };
  }
  if (!me.stripeConnected) {
    return {
      needsPayments: true,
      reason:
        me.role === "staff"
          ? "Set up payments first — ask the business owner to finish it from their app."
          : "Set up payments first.",
      cta: "Set up payments",
      href: "/get-paid",
    };
  }
  return null;
}

// Review 4 — a live plan nobody can join yet says "Ready" instead of "Live"
// (My plans, Edit plan). The chip stays short and the reason sits under it
// as a full line: in the one-line chip it was cut off (QA 26 Nov).
export function readyLabel(): string {
  return "Ready";
}

export function readyNote(lock: OfferLock): string | null {
  if (lock.needsGasSafe && lock.needsPayments) return "Customers can join once your Gas Safe check and payments are done.";
  if (lock.needsGasSafe) return "Customers can join once your Gas Safe check is done.";
  if (lock.needsPayments) return "Customers can join once payments are set up.";
  return null;
}
