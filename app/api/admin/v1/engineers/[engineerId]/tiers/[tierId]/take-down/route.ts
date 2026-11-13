import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { ReasonBody } from "@/lib/admin-api/schemas";
import { takeDownTier } from "@/lib/admin/engineers";

// Take a plan that breaks the rules off sale: no new customers, those on it
// keep it, the engineer is told why. 409 unless it's on sale.
export const POST = adminRoute<{ engineerId: string; tierId: string }>("engineers:status", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, ReasonBody);
  return takeDownTier(admin, params.engineerId, params.tierId, reason);
});
