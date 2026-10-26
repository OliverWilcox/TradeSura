import { adminRoute } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { money } from "@/lib/admin/dashboard";

// Collections by month (the last six) and in the range, from paid Stripe invoices.
export const GET = adminRoute("dashboard:read", async ({ req }) => money(parseRange(req), new Date()));
