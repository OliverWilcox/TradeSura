// APP_URL is only set for the Production environment on Vercel (a human sets
// it per environment) — Preview and Development have no value, which broke
// every link-building call site (customer signup links, portal links, Stripe
// Connect's business_url) with a literal "undefined/..." URL. Vercel already
// exposes a per-deployment hostname as VERCEL_URL; fall back to that, then to
// localhost for local dev.
export function appUrl(): string {
  // Whitespace stripped anywhere: a stray line break pasted into the env
  // value ("http⏎s://…") otherwise ends up inside every link and QR code.
  const configured = process.env.APP_URL?.replace(/\s+/g, "").replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
