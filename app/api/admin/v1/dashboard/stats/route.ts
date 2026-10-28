import { adminRoute } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { stats } from "@/lib/admin/dashboard";

// Headline numbers for a range: sign-ups, verified, active engineers, live
// plans, customers on a plan, offers and offer-to-sign-up.
export const GET = adminRoute("dashboard:read", async ({ req }) => stats(parseRange(req)));
