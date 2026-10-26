import { adminRoute } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { health } from "@/lib/admin/dashboard";

// Cancellations (with the top reasons) and failed payments in the range.
export const GET = adminRoute("dashboard:read", async ({ req }) => health(parseRange(req)));
