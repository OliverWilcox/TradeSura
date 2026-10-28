import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams, sortDir } from "@/lib/admin-api/pagination";
import { customerFilters } from "@/lib/admin-api/filters";
import { listCustomers } from "@/lib/admin/customers";

const Query = z.strictObject({
  ...customerFilters,
  sort: z.enum(["added", "name", "since", "postcode", "engineer", "price"]).optional(),
  dir: sortDir,
  ...pageParams,
});

// Every homeowner on every engineer's book, with the plan they're on now.
export const GET = adminRoute("customers:read", async ({ req }) => listCustomers(parseQuery(req, Query)));
