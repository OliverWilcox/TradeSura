import type { Href } from "expo-router";
import type { Me } from "@/lib/auth-context";

// Matt's Getting Started layout (Review 4, 28 Oct): GO LIVE = the three
// steps needed to take customers (the ring counts only these), GROW = any
// time, optional. One place for both, so the hub, Home and the setup exits
// always agree. Real statuses only: a tick means done, never "opened".
export type StepTone = "done" | "amber" | "grey" | "red";

export type SetupStep = {
  key: string;
  title: string;
  sub: string;
  /** £ figure in the subtitle, shown in money-green. */
  money?: string;
  done: boolean;
  /** The status pill: "Done", "Photo needed", "In review · usually 24 hours"… */
  status: string;
  tone: StepTone;
  /** Waiting on someone else (our check, Stripe's review): nothing to tap. */
  waiting?: boolean;
  /** Not available yet: shown with a padlock and can't be opened. */
  locked?: boolean;
  /** Label for the step's button; none while waiting. */
  cta?: string;
  href: Href;
  /** What Home's card says next ("add your Gas Safe photo"). */
  next: string;
};

const FEE_RATE = 0.2;
const pounds = (p: number) => `£${(p / 100).toFixed(2).replace(/\.00$/, "")}`;

export function goLiveSteps(me: Me | null): SetupStep[] {
  const plan = me?.firstPlan ?? null;
  // An unfinished wizard draft and no live plan yet: step 1 resumes it.
  const draft = !me?.hasPlan ? (me?.draftPlan ?? null) : null;
  const number = me?.gasSafeNo ?? null;
  const verified = Boolean(me?.gasSafeVerifiedAt);
  const rejected = Boolean(me?.gasSafeRejectedAt) && !verified;
  const photoNeeded = !verified && me?.hasGasSafeCard === false;
  const paidReady = Boolean(me?.stripeConnected && me?.stripePayoutsEnabled);
  const state = me?.stripeState;
  // Stripe has everything and is checking it (not "needs one more thing").
  const paidReview =
    !paidReady &&
    (state === "checking" || Boolean(me?.stripeConnected && state !== "needs_more" && state !== "half"));

  const planStep: SetupStep = me?.hasPlan
    ? {
        key: "plan",
        title: "Build your first plan",
        sub: plan ? `${plan.name} · ` : "Your plan is live",
        money: plan ? `${pounds(plan.priceMonthlyPence)} a month` : undefined,
        done: true,
        status: "Done",
        tone: "done",
        href: "/plans",
        next: "",
      }
    : draft
      ? {
          key: "plan",
          title: "Build your first plan",
          sub: `${draft.name ? `${draft.name} is` : "Your plan is"} saved as a draft. Pick up where you left off.`,
          done: false,
          status: "Draft saved",
          tone: "amber",
          cta: "Finish plan",
          href: { pathname: "/plan-wizard", params: { tierId: draft.id, from: "setup" } },
          next: "finish your plan",
        }
      : {
          key: "plan",
          title: "Build your first plan",
          sub: "Start from Boiler Care at ",
          money: "£12",
          done: false,
          status: "Not started",
          tone: "grey",
          cta: "Build plan",
          // Opens the builder with its "Back to setup" bar.
          href: { pathname: "/plans", params: { from: "setup" } },
          next: "build your first plan",
        };

  const gasStep: SetupStep = verified
    ? {
        key: "gassafe",
        title: "Gas Safe check",
        sub: `${number ? `Number ${number} verified. ` : ""}Your Verified Member badge is on.`,
        done: true,
        status: "Done",
        tone: "done",
        href: "/more",
        next: "",
      }
    : rejected
      ? {
          key: "gassafe",
          title: "Gas Safe check",
          sub: "We couldn't verify your number. Check it and try again.",
          done: false,
          status: "Needs attention",
          tone: "red",
          cta: "See why",
          href: "/more",
          next: "check your Gas Safe number",
        }
      : photoNeeded
        ? {
            key: "gassafe",
            title: "Gas Safe check",
            sub: `${number ? `Number ${number} added. ` : ""}Add a photo of your ID card so we can verify you.`,
            done: false,
            status: "Photo needed",
            tone: "amber",
            cta: "Add photo",
            href: "/add-id",
            next: "add your Gas Safe photo",
          }
        : {
            key: "gassafe",
            title: "Gas Safe check",
            sub: `${number ? `Number ${number} and` : "Your"} ID photo are in. We're checking them.`,
            done: false,
            status: "In review · usually 24 hours",
            tone: "amber",
            waiting: true,
            href: "/more",
            next: "your Gas Safe check is in review",
          };

  const paidStep: SetupStep = paidReady
    ? {
        key: "paid",
        title: "Get paid",
        sub: "Payments are on. Paid out every Friday.",
        done: true,
        status: "Done",
        tone: "done",
        href: "/payouts",
        next: "",
      }
    : paidReview
      ? {
          key: "paid",
          title: "Get paid",
          sub: "Stripe is checking your details. Nothing to do.",
          done: false,
          status: "In review · usually 24 hours",
          tone: "amber",
          waiting: true,
          href: "/get-paid",
          next: "Stripe is checking your details",
        }
      : state === "half" || state === "needs_more"
        ? {
            key: "paid",
            title: "Get paid",
            sub: state === "half" ? "About 1 minute left with Stripe. We saved your progress." : "Stripe needs one more thing from you.",
            done: false,
            status: state === "half" ? "Half set up" : "Stripe needs more",
            tone: "amber",
            cta: "Finish",
            href: "/get-paid",
            next: "finish setting up payments",
          }
        : {
            key: "paid",
            title: "Get paid",
            sub: "About 3 minutes with Stripe",
            done: false,
            status: "Not set up",
            tone: "grey",
            cta: "Set up",
            href: "/get-paid",
            next: "set up payments",
          };

  return [planStep, gasStep, paidStep];
}

export function growSteps(me: Me | null): SetupStep[] {
  const plan = me?.firstPlan ?? null;
  const price = plan?.priceMonthlyPence ?? 1200;
  // Our 20% rounds down to the penny, in the engineer's favour.
  const yearlyKeep = Math.round(((price - Math.floor(price * FEE_RATE)) * 12) / 100);
  const customers = me?.customerCount ?? 0;
  const referrals = me?.referralCount ?? 0;
  const shared = Boolean(me?.inviteSharedAt) || referrals > 0;
  return [
    {
      key: "profile",
      title: "Get found on Google",
      sub: me?.profilePublishedAt ? "Your free profile page is live" : "Your free profile page",
      done: Boolean(me?.profilePublishedAt),
      status: me?.profilePublishedAt ? "Published" : "Draft · not published",
      tone: me?.profilePublishedAt ? "done" : "amber",
      cta: me?.profilePublishedAt ? "View" : "Publish",
      href: "/profile",
      next: "get found on Google",
    },
    {
      key: "website",
      title: "Connect your website",
      // Ticks when the code is seen working on their site (app/embed).
      sub: me?.websiteConnectedAt ? "Your plans are on your website" : "Sell plans there too",
      done: Boolean(me?.websiteConnectedAt),
      status: me?.websiteConnectedAt ? "Live on your site" : "Not added yet",
      tone: me?.websiteConnectedAt ? "done" : "grey",
      cta: me?.websiteConnectedAt ? "View" : "Get code",
      href: "/website",
      next: "connect your website",
    },
    {
      key: "customers",
      title: "Bring in your customers",
      // Review 3 — opens once a plan is live, so there's something to offer.
      sub: me?.hasPlan ? "Each one worth up to " : "Opens once your first plan is live",
      money: me?.hasPlan ? `£${yearlyKeep} a year to you` : undefined,
      done: customers > 0,
      status: customers > 0 ? `${customers} customer${customers === 1 ? "" : "s"} added` : "None yet",
      tone: customers > 0 ? "done" : "grey",
      locked: !me?.hasPlan && customers === 0,
      cta: customers > 0 ? "Add more" : "Add",
      href: "/customers/import-contacts",
      next: "bring in your customers",
    },
    {
      key: "invite",
      title: "Invite engineers you know",
      // Build Review 2, ruling 4 — the affiliate deal. Ticks once shared or
      // someone joins, never just for opening the page.
      sub: "Earn 25% of our fee on their plans",
      done: shared,
      status: referrals > 0 ? `${referrals} joined` : shared ? "Shared" : "Not shared yet",
      tone: shared ? "done" : "grey",
      cta: "Share",
      // Opened as a setup step: no tab bar (Review 3 §3).
      href: { pathname: "/referral", params: { from: "setup" } },
      next: "invite engineers you know",
    },
  ];
}

// The member pack is a status card, not a step: it posts on its own once
// the Verified Member badge is live.
export function packStatus(me: Me | null): { status: string; tone: StepTone; line: string } {
  if (me?.packShippedAt) return { status: "Posted", tone: "done", line: "Arrives in 2–3 days" };
  if (!me?.packAddress) return { status: "Address needed", tone: "amber", line: "Add the address we should post it to." };
  if (me.gasSafeVerifiedAt) return { status: "Being posted", tone: "grey", line: "Your badge is live, so your pack is on its way out." };
  return { status: "Waiting", tone: "grey", line: "Posts when your Verified Member badge goes live." };
}

export function goLiveDone(me: Me | null): boolean {
  return goLiveSteps(me).every((s) => s.done);
}

// Review 4 — "until setup is finished or skipped, every exit returns to the
// Getting Started hub". Finished = the go-live steps: a live plan, payments
// and the Gas Safe ID in. Skipped = "Skip for now" on the hub. Staff never
// see the hub.
export function inSetup(me: Me | null, skipped: boolean): boolean {
  if (!me || me.role === "staff" || skipped) return false;
  return !(me.hasPlan && me.stripeConnected && (me.hasGasSafeCard || me.gasSafeVerifiedAt));
}
