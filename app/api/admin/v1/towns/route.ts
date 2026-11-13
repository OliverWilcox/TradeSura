import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams } from "@/lib/admin-api/pagination";
import { listTowns } from "@/lib/admin/towns";

const Query = z.strictObject({ q: z.string().trim().max(80).optional(), ...pageParams });

// Every town with a page, an engineer or a top spot, A–Z: its spots taken,
// live and released, and the Founding Members waiting for one.
export const GET = adminRoute("towns:read", async ({ req }) => listTowns(parseQuery(req, Query)));
