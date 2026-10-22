// Review 3 — the invite link reads tradesura.com/join/{slug}; same landing
// page as the older /r/{slug}, which keeps working for links already shared.
export const dynamic = "force-dynamic";
export { default, generateMetadata } from "@/app/r/[slug]/page";
