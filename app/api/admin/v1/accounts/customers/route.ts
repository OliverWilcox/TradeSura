import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams, sortDir } from "@/lib/admin-api/pagination";
import { isoDay } from "@/lib/admin-api/schemas";
import { listCustomerAccounts } from "@/lib/admin/accounts";

const Query = z.strictObject({
  /** Several searches at once, separated by commas: a person's emails and mobile. */
  q: z.string().trim().max(500).optional(),
  deletable: z.enum(["yes", "no"]).optional(),
  addedFrom: isoDay.optional(),
  addedTo: isoDay.optional(),
  sort: z.enum(["added"]).optional(),
  dir: sortDir,
  ...pageParams,
});

// Customers to delete, with what deleting each would do.
export const GET = adminRoute("data:delete", async ({ req }) => listCustomerAccounts(parseQuery(req, Query)));
