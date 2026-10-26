import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { customerFilters } from "@/lib/admin-api/filters";
import { ndjson } from "@/lib/admin-api/stream";
import { exportCustomers } from "@/lib/admin/customers";

const Query = z.strictObject(customerFilters);

// Every customer the list's filters match, newest first, as the list shows
// them, streamed as NDJSON for a CSV export (one request, however many).
export const GET = adminRoute("customers:read", async ({ req, requestId }) => ndjson(exportCustomers(parseQuery(req, Query)), requestId));
