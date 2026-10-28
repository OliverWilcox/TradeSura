import { z } from "zod";
import { adminRoute, parseQuery } from "@/lib/admin-api/route";
import { pageParams } from "@/lib/admin-api/pagination";
import { customerActivity } from "@/lib/admin/customers";

const Query = z.strictObject({ ...pageParams });

// Anything recorded about this customer, newest first.
export const GET = adminRoute<{ customerId: string }>("customers:read", async ({ req, params }) =>
  customerActivity(params.customerId, parseQuery(req, Query)),
);
