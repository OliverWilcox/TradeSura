import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { engineerFilters } from "@/lib/admin-api/filters";
import { ndjson } from "@/lib/admin-api/stream";
import { exportEngineers } from "@/lib/admin/engineers";

const Query = z.strictObject(engineerFilters);

// Every engineer the list's filters match, newest first, as the list shows
// them, streamed as NDJSON for a CSV export (one request, however many).
export const GET = adminRoute("engineers:read", async ({ req, requestId }) => ndjson(exportEngineers(parseQuery(req, Query)), requestId));
