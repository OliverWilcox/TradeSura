import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { optionalReason } from "@/lib/admin-api/schemas";
import { markTestData, unmarkTestData } from "@/lib/admin/test-data";

const Body = z.strictObject({ reason: optionalReason });

// Mark a customer as test data (POST) or not (DELETE). Their plans and
// payments leave every admin figure with them.
export const POST = adminRoute<{ customerId: string }>("data:delete", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, Body);
  return markTestData(admin, "customer", params.customerId, reason ?? null);
});

export const DELETE = adminRoute<{ customerId: string }>("data:delete", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, Body);
  return unmarkTestData(admin, "customer", params.customerId, reason ?? null);
});
