import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams } from "@/lib/admin-api/pagination";
import { engineerActivity } from "@/lib/admin/engineers";

const Query = z.strictObject({ ...pageParams });

// The engineer's own actions and anything done to them, newest first.
export const GET = adminRoute<{ engineerId: string }>("engineers:read", async ({ req, params }) =>
  engineerActivity(params.engineerId, parseQuery(req, Query)),
);
