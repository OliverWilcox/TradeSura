// Build Guide v2 Part 6.4 LAW — one truth source, one priority ladder:
// banned > paused > Stripe-needs-info > check-failed > check-pending > active.
import { describe, expect, it } from "vitest";
import { standingState, standingCopy, gasSafeStatus, paymentsStatus } from "@/lib/verification-state";

const BASE = {
  bannedAt: null,
  banReason: null,
  pausedAt: null,
  pauseReason: null,
  stripeAccountId: null,
  stripeDetailsSubmitted: false,
  stripeChargesEnabled: false,
  gasSafeNo: null,
  gasSafeVerifiedAt: null,
  gasSafeReviewRequestedAt: null,
  gasSafeRejectedAt: null,
  gasSafeRejectReason: null,
} as const;

describe("standingState", () => {
  // Build Guide v2 review 17 Sept, B1 — "Home shows 'Gas Safe verified —
  // account active' ... but the account is NOT verified." This exact test
  // used to assert the bug as correct behaviour (ACTIVE with nothing else
  // set, i.e. not actually verified) — the fallback should never be ACTIVE.
  it("never defaults to active — an engineer with nothing set is not verified", () => {
    expect(standingState(BASE)).not.toBe("ACTIVE");
  });

  // 29 Sept review — a fresh account that never had anything rejected must
  // read as pending, not failed.
  it("pending, not failed, when nothing has been rejected", () => {
    expect(standingState(BASE)).toBe("CHECK_PENDING");
    expect(standingState({ ...BASE, gasSafeNo: "584120" })).toBe("CHECK_PENDING");
  });

  it("failed only once a reviewer has rejected it", () => {
    expect(
      standingState({ ...BASE, gasSafeNo: "584120", gasSafeRejectedAt: new Date() }),
    ).toBe("CHECK_FAILED");
  });

  it("check pending when a review is requested and not yet verified", () => {
    expect(standingState({ ...BASE, gasSafeNo: "1", gasSafeReviewRequestedAt: new Date() })).toBe(
      "CHECK_PENDING",
    );
  });

  it("Stripe needs info once details are submitted but charges aren't enabled", () => {
    expect(
      standingState({
        ...BASE,
        stripeAccountId: "acct_1",
        stripeDetailsSubmitted: true,
        stripeChargesEnabled: false,
      }),
    ).toBe("STRIPE_NEEDS_INFO");
  });

  it("banned outranks every other state", () => {
    expect(
      standingState({
        ...BASE,
        bannedAt: new Date(),
        pausedAt: new Date(),
        stripeAccountId: "acct_1",
        stripeDetailsSubmitted: true,
        stripeChargesEnabled: false,
      }),
    ).toBe("BANNED");
  });

  it("paused outranks Stripe-needs-info and the Gas Safe states", () => {
    expect(
      standingState({
        ...BASE,
        pausedAt: new Date(),
        gasSafeNo: "1",
        gasSafeReviewRequestedAt: new Date(),
      }),
    ).toBe("PAUSED");
  });

  it("a verified engineer with everything else healthy is active even mid-Stripe-onboarding", () => {
    expect(
      standingState({
        ...BASE,
        gasSafeNo: "1",
        gasSafeVerifiedAt: new Date(),
        stripeAccountId: "acct_1",
        stripeDetailsSubmitted: false,
        stripeChargesEnabled: false,
      }),
    ).toBe("ACTIVE");
  });
});

describe("standingCopy", () => {
  it("uses the Part 18 verbatim active string", () => {
    expect(standingCopy({ ...BASE, gasSafeNo: "1", gasSafeVerifiedAt: new Date() }).text).toBe(
      "Gas Safe verified — account active.",
    );
  });

  it("uses the pending string (Build Review 2: no texts until SMS is live)", () => {
    expect(
      standingCopy({ ...BASE, gasSafeNo: "1", gasSafeReviewRequestedAt: new Date() }).text,
    ).toBe("Gas Safe check in progress — we'll let you know within 24 hours.");
  });
});

// Build Guide v2 Part 13 — Account's two independent status lines. Same
// words as the collapsed strip, but Gas Safe and Payments never hide each
// other the way the ladder does.
describe("gasSafeStatus", () => {
  it("verified wins even if a review was also requested at some point", () => {
    expect(
      gasSafeStatus({ gasSafeNo: "1", gasSafeVerifiedAt: new Date(), gasSafeReviewRequestedAt: new Date(), gasSafeRejectedAt: null })
        .tone,
    ).toBe("quiet");
  });
  it("pending when a review is requested and not yet verified", () => {
    const s = gasSafeStatus({ gasSafeNo: "1", gasSafeVerifiedAt: null, gasSafeReviewRequestedAt: new Date(), gasSafeRejectedAt: null });
    expect(s.tone).toBe("amber");
    expect(s.text).toContain("check in progress");
  });
});

describe("paymentsStatus", () => {
  it("active once charges are enabled", () => {
    expect(
      paymentsStatus({ stripeAccountId: "acct_1", stripeDetailsSubmitted: true, stripeChargesEnabled: true })
        .text,
    ).toBe("Payments — active, paid every Friday.");
  });
  it("needs more information mid-onboarding", () => {
    expect(
      paymentsStatus({ stripeAccountId: "acct_1", stripeDetailsSubmitted: true, stripeChargesEnabled: false })
        .tone,
    ).toBe("amber");
  });
  it("stays independent of the Gas Safe axis entirely", () => {
    // A Stripe-only fact — no Gas Safe fields even exist on the input type.
    expect(paymentsStatus({ stripeAccountId: null, stripeDetailsSubmitted: false, stripeChargesEnabled: false }).text).toBe(
      "Set up payments →",
    );
  });
});
