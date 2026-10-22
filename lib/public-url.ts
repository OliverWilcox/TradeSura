import { appUrl } from "@/lib/app-url";

// The engineer's public address: tradesura.com/{slug} — profile page and
// plan list in one (2026 Build Guide "Your plan link"). /p/{slug} still
// works and redirects here, so old QR stickers and texts keep landing.
export function profileUrl(slug: string): string {
  return `${appUrl()}/${slug}`;
}

// The same address without the scheme, for showing on screen.
export function profileDisplay(slug: string): string {
  return profileUrl(slug).replace(/^https?:\/\/(www\.)?/, "");
}

// Review 3 — the plan link the engineer shares reads tradesura.com/p/{slug}
// (the plans page); tradesura.com/{slug} is their profile. Both render the
// same engineer page.
export function planLinkUrl(slug: string): string {
  return `${appUrl()}/p/${slug}`;
}

export function planLinkDisplay(slug: string): string {
  return planLinkUrl(slug).replace(/^https?:\/\/(www\.)?/, "");
}

// What the engineer (or whoever runs their website) pastes to show their
// plans there — see public/embed.js.
export function embedSnippet(slug: string): string {
  return `<div data-tradesura="${slug}"></div>\n<script src="${appUrl()}/embed.js" async></script>`;
}

// Section 6 — the profile built for Google:
// tradesura.com/gas-engineers/{town}/{slug}. tradesura.com/{slug} redirects
// here once the engineer has a town; /p/{slug} stays the plan link.
export function gasEngineerPath(townSlug: string, slug: string): string {
  return `/gas-engineers/${townSlug}/${slug}`;
}

export function townPageUrl(townSlug: string): string {
  return `${appUrl()}/gas-engineers/${townSlug}`;
}

// The engineer's canonical public address: the town profile when they have
// a town, otherwise tradesura.com/{slug}.
export function canonicalProfileUrl(e: { slug: string; townSlug: string | null }): string {
  return e.townSlug ? `${appUrl()}${gasEngineerPath(e.townSlug, e.slug)}` : profileUrl(e.slug);
}

export function canonicalProfileDisplay(e: { slug: string; townSlug: string | null }): string {
  return canonicalProfileUrl(e).replace(/^https?:\/\/(www\.)?/, "");
}
