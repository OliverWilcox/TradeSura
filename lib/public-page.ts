import { signToken, verifyToken } from "@/lib/auth";
import { offerBlockedReason } from "@/lib/verification-state";

// Review 4 (P0) — the engineer's public page has four modes:
//   live      — customers can join (Gas Safe check done AND payments set up)
//   closed    — the plans show, but Join is off until the engineer is live
//   preview   — the engineer checking their own profile from the app
//   practice  — demo mode while offers are locked: DEMO on screen, Join runs
//               a pretend sign-up that saves nothing and takes no payment
// Preview and practice never create a customer, plan or mandate; the start
// route refuses an engineer who isn't live as well, so a hand-built URL
// can't get round it.
export type PageMode = "live" | "closed" | "preview" | "practice";

export function pageMode(opts: {
  preview: boolean;
  practice: boolean;
  engineer: Parameters<typeof offerBlockedReason>[0];
}): PageMode {
  if (opts.preview) return "preview";
  if (opts.practice) return "practice";
  return offerBlockedReason({ ...opts.engineer, stripeChargesEnabled: opts.engineer.stripeChargesEnabled ?? false })
    ? "closed"
    : "live";
}

// The profile at /gas-engineers/{town}/{slug} is public only once the
// engineer publishes it; before that only their own preview link opens it.
export function profileVisible(published: boolean, preview: boolean): boolean {
  return published || preview;
}

// A short-lived link the app opens for "Preview my profile". It carries only
// the slug (never engineerId), so it can't be used as a sign-in token.
const PREVIEW_TTL = "30m";

export async function profilePreviewToken(slug: string): Promise<string> {
  return signToken({ previewSlug: slug }, PREVIEW_TTL);
}

export async function isProfilePreview(token: string | undefined, slug: string): Promise<boolean> {
  if (!token) return false;
  const payload = await verifyToken(token);
  return payload?.previewSlug === slug;
}
