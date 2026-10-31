import { z } from "zod";
import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { optionalReason } from "@/lib/admin-api/schemas";
import { markTestData, unmarkTestData } from "@/lib/admin/test-data";

const Body = z.strictObject({ reason: optionalReason });

// Mark an engineer as test data (POST) or not (DELETE). Their customers,
// offers and payments leave every admin figure with them.
export const POST = adminRoute<{ engineerId: string }>("data:delete", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, Body);
  return markTestData(admin, "engineer", params.engineerId, reason ?? null);
});

export const DELETE = adminRoute<{ engineerId: string }>("data:delete", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, Body);
  return unmarkTestData(admin, "engineer", params.engineerId, reason ?? null);
});
