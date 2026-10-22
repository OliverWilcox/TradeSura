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
  /** Label for the inline button on the current step. */
  cta: string;
  href: Href;
};

const FEE_RATE = 0.2;

export function setupSteps(me: Me | null): SetupStep[] {
  const plan = me?.firstPlan ?? null;
  const price = plan?.priceMonthlyPence ?? 1200;
  // Our 20% rounds down to the penny, in the engineer's favour.
  const yearlyKeep = Math.round(((price - Math.floor(price * FEE_RATE)) * 12) / 100);
  return [
    {
      key: "plan",
      title: "Build your first plan",
      // Review 3 — don't say customers can join before they actually can.
      sub: plan
        ? me?.gasSafeVerifiedAt && me?.stripeConnected
          ? `${plan.name} · `
          : "Plan ready. Customers can join once payments are set up and your Gas Safe check is done."
        : "Start from Boiler Care at ",
      money: plan
        ? me?.gasSafeVerifiedAt && me?.stripeConnected
          ? `£${(plan.priceMonthlyPence / 100).toFixed(2).replace(/\.00$/, "")} a month`
          : undefined
        : "£12",
      done: Boolean(me?.hasPlan),
      cta: "Build my plan",
      // Opens the builder with its "Back to setup" bar.
      href: { pathname: "/plans", params: { from: "setup" } },
    },
    {
      key: "paid",
      title: "Get paid",
      sub: me?.stripeConnected ? "Paid out every Friday" : "About 3 minutes with Stripe",
      done: Boolean(me?.stripeConnected),
      cta: me?.stripeDetailsSubmitted ? "Finish payments" : "Set up payments",
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
      sub: "Each one worth up to ",
      money: `£${yearlyKeep} a year to you`,
      done: (me?.customerCount ?? 0) > 0,
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
      href: "/referral",
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
