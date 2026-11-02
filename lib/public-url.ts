import { appUrl } from "@/lib/app-url";

// Review 4 (Matt's decision) — one address everywhere: tradesura.com/{slug}.
// It is the profile, the plan list, the QR codes, the Stripe website and
// what the engineer shares; each plan hangs off it
// (tradesura.com/{slug}/{plan}). The old /p/{slug} and
// /gas-engineers/{town}/{slug} addresses redirect here.
export function profileUrl(slug: string): string {
  return `${appUrl()}/${slug}`;
}

// The same address without the scheme, for showing on screen.
export function profileDisplay(slug: string): string {
  return profileUrl(slug).replace(/^https?:\/\/(www\.)?/, "");
}

// The plan link: the business address, or one plan's own link when a plan
// slug is given (lib/plan-slugs.ts).
export function planLinkUrl(slug: string, planSlug?: string | null): string {
  return planSlug ? `${profileUrl(slug)}/${planSlug}` : profileUrl(slug);
}

export function planLinkDisplay(slug: string, planSlug?: string | null): string {
  return planLinkUrl(slug, planSlug).replace(/^https?:\/\/(www\.)?/, "");
}

// A customer's own sign-up link (offer texts, Join): the Direct Debit steps
// for one pending plan, under the same address.
export function signupPath(slug: string, token: string): string {
  return `/${slug}/signup/${token}`;
}

export function signupUrl(slug: string, token: string): string {
  return `${appUrl()}${signupPath(slug, token)}`;
}

// What the engineer (or whoever runs their website) pastes to show their
// plans there — see public/embed.js.
export function embedSnippet(slug: string): string {
  return `<div data-tradesura="${slug}"></div>\n<script src="${appUrl()}/embed.js" async></script>`;
}

// Section 6's town profile address, kept only so old links redirect to the
// one address.
export function gasEngineerPath(townSlug: string, slug: string): string {
  return `/gas-engineers/${townSlug}/${slug}`;
}

export function townPageUrl(townSlug: string): string {
  return `${appUrl()}/gas-engineers/${townSlug}`;
}

// The engineer's canonical public address. Since Review 4 it is always
// tradesura.com/{slug}; the town shows on the page and in its heading.
export function canonicalProfileUrl(e: { slug: string }): string {
  return profileUrl(e.slug);
}

export function canonicalProfileDisplay(e: { slug: string }): string {
  return profileDisplay(e.slug);
}
