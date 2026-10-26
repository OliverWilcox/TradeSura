import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { ReasonBody } from "@/lib/admin-api/schemas";
import { unbanEngineer } from "@/lib/admin/engineers";

// Lift a ban.
export const POST = adminRoute<{ engineerId: string }>("engineers:ban", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, ReasonBody);
  return unbanEngineer(admin, params.engineerId, reason);
});
