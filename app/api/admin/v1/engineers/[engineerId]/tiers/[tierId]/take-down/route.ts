import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { ReasonBody } from "@/lib/admin-api/schemas";
import { takeDownTier } from "@/lib/admin/engineers";

export const POST = adminRoute<{ engineerId: string; tierId: string }>("engineers:status", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, ReasonBody);
  return takeDownTier(admin, params.engineerId, params.tierId, reason);
});
