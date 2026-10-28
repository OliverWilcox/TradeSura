import { adminRoute } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { funnel } from "@/lib/admin/dashboard";

// Engineers who signed up in the range, and how many have reached each step since.
export const GET = adminRoute("dashboard:read", async ({ req }) => funnel(parseRange(req)));
