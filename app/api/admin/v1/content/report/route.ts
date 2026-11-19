import { adminRoute } from "@/lib/admin-api/route";
import { parseRange } from "@/lib/admin-api/range";
import { conversionReport } from "@/lib/admin/content";

export const GET = adminRoute("content:read", async ({ req }) => conversionReport(parseRange(req)));
