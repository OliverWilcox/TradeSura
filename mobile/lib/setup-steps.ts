import type { Href } from "expo-router";
import type { Me } from "@/lib/auth-context";

// The getting-started hub's seven steps (2026 Build Guide hub target), in
// one place so the hub and the dashboard's "Finish setup — N of 7" card
// always count the same things.
export type SetupStep = {
  key: string;
  title: string;
  sub: string;
  /** £ figure in the subtitle, shown in money-green. */
  money?: string;
  done: boolean;
  /** Waiting on someone else (Stripe's review): amber, not a tick. */
  pending?: boolean;
  /** Not available yet: shown with a padlock and can't be opened. */
  locked?: boolean;
  /** Label for the inline button on the current step. */
  cta: string;
  href: Href;
};

const FEE_RATE = 0.2;

export function setupSteps(me: Me | null): SetupStep[] {
  const plan = me?.firstPlan ?? null;
  // An unfinished wizard draft and no live plan yet: step 1 resumes it.
  const draft = !me?.hasPlan ? (me?.draftPlan ?? null) : null;
  const price = plan?.priceMonthlyPence ?? 1200;
  // Our 20% rounds down to the penny, in the engineer's favour.
  const yearlyKeep = Math.round(((price - Math.floor(price * FEE_RATE)) * 12) / 100);
  const paidReady = Boolean(me?.stripeConnected && me?.stripePayoutsEnabled);
  // Stripe has everything and is checking it (not "needs one more thing").
  const paidReview =
    !paidReady &&
    (me?.stripeState === "checking" ||
      Boolean(me?.stripeConnected && me?.stripeState !== "needs_more" && me?.stripeState !== "half"));
  return [
    {
      key: "plan",
      title: "Build your first plan",
      // Review 3 — don't say customers can join before they actually can.
      sub: plan
        ? me?.gasSafeVerifiedAt && me?.stripeConnected
          ? `${plan.name} · `
          : "Plan ready. Customers can join once payments are set up and your Gas Safe check is done."
        : draft
          ? `${draft.name ? `${draft.name} is` : "Your plan is"} saved as a draft. Pick up where you left off.`
          : "Start from Boiler Care at ",
      money: plan
        ? me?.gasSafeVerifiedAt && me?.stripeConnected
          ? `£${(plan.priceMonthlyPence / 100).toFixed(2).replace(/\.00$/, "")} a month`
          : undefined
        : draft
          ? undefined
          : "£12",
      done: Boolean(me?.hasPlan),
      cta: draft ? "Finish my plan" : "Build my plan",
      // Opens the builder with its "Back to setup" bar.
      href: draft
        ? { pathname: "/plan-wizard", params: { tierId: draft.id, from: "setup" } }
        : { pathname: "/plans", params: { from: "setup" } },
    },
    {
      key: "paid",
      title: "Get paid",
      // Review 4 — no green tick while Stripe is still checking: amber
      // "In review" until payouts are switched on.
      sub: paidReady
        ? "Paid out every Friday"
        : paidReview
          ? "In review · Stripe usually confirms within 24 hours"
          : "About 3 minutes with Stripe",
      done: paidReady,
      pending: paidReview,
      cta: me?.stripeDetailsSubmitted || me?.stripeState === "half" || me?.stripeState === "needs_more" ? "Finish payments" : "Set up payments",
      href: "/get-paid",
    },
    {
      key: "profile",
      title: "Get found on Google",
      sub: "Your free profile page",
      done: Boolean(me?.profilePublishedAt),
      cta: "Set up profile",
      href: "/profile",
    },
    {
      key: "website",
      title: "Connect your website",
      sub: "Sell plans there too",
      done: Boolean(me?.websiteConnectedAt),
      cta: "Get the code",
      href: "/website",
    },
    {
      key: "customers",
      title: "Bring in your customers",
      // Review 3 — opens once a plan is live, so there's something to offer.
      sub: me?.hasPlan ? "Each one worth up to " : "Opens once your first plan is live",
      money: me?.hasPlan ? `£${yearlyKeep} a year to you` : undefined,
      done: (me?.customerCount ?? 0) > 0,
      locked: !me?.hasPlan && (me?.customerCount ?? 0) === 0,
      cta: "Import customers",
      href: "/customers/import-contacts",
    },
    {
      key: "invite",
      title: "Invite engineers you know",
      // Build Review 2, ruling 4 — the affiliate deal, as on the hub target.
      sub: "Earn 25% of our fee on their plans",
      done: Boolean(me?.inviteSharedAt) || (me?.referralCount ?? 0) > 0,
      cta: "Share invite",
      // Opened as a setup step: no tab bar (Review 3 §3).
      href: { pathname: "/referral", params: { from: "setup" } },
    },
    {
      key: "pack",
      title: "Member pack",
      sub: "Posts when your badge goes live",
      done: Boolean(me?.packRequestedAt),
      cta: "Add address",
      href: "/member-pack",
    },
  ];
}

// Review 4 — "until setup is finished or skipped, every exit returns to the
// Getting Started hub". Finished = the go-live steps: a live plan, payments
// and the Gas Safe ID in. Skipped = "Skip setup for now" on the hub. Staff
// never see the hub.
export function inSetup(me: Me | null, skipped: boolean): boolean {
  if (!me || me.role === "staff" || skipped) return false;
  return !(me.hasPlan && me.stripeConnected && (me.hasGasSafeCard || me.gasSafeVerifiedAt));
}
