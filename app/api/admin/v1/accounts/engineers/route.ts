import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams, sortDir } from "@/lib/admin-api/pagination";
import { isoDay } from "@/lib/admin-api/schemas";
import { listEngineerAccounts } from "@/lib/admin/accounts";

const Query = z.strictObject({
  /** Several searches at once, separated by commas: a person's emails and mobile. */
  q: z.string().trim().max(500).optional(),
  role: z.enum(["owner", "staff"]).optional(),
  status: z.enum(["active", "paused", "banned", "left"]).optional(),
  deletable: z.enum(["yes", "no"]).optional(),
  joinedFrom: isoDay.optional(),
  joinedTo: isoDay.optional(),
  sort: z.enum(["joined"]).optional(),
  dir: sortDir,
  ...pageParams,
});

// Engineer accounts to delete, with what deleting each would do.
export const GET = adminRoute("data:delete", async ({ req }) => listEngineerAccounts(parseQuery(req, Query)));
