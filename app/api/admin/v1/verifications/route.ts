import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams, sortDir } from "@/lib/admin-api/pagination";
import { listVerifications } from "@/lib/admin/verifications";

const Query = z.strictObject({
  tab: z.enum(["card", "register", "no_card", "recheck", "duplicates", "pending", "decided"]).default("pending"),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["submitted", "decided", "name", "business"]).optional(),
  dir: sortDir,
  ...pageParams,
});

export const GET = adminRoute("verification:read", async ({ req }) => listVerifications(parseQuery(req, Query)));
