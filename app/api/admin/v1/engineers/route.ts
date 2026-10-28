import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams, sortDir } from "@/lib/admin-api/pagination";
import { engineerFilters } from "@/lib/admin-api/filters";
import { listEngineers } from "@/lib/admin/engineers";

const Query = z.strictObject({
  ...engineerFilters,
  sort: z.enum(["joined", "name", "business", "plans", "tiers", "customers", "customersOnPlans", "lastOffer"]).optional(),
  dir: sortDir,
  ...pageParams,
});

// Every engineer account (deleted ones excepted), searchable and filterable.
export const GET = adminRoute("engineers:read", async ({ req }) => listEngineers(parseQuery(req, Query)));
