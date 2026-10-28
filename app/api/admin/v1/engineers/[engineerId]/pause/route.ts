import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { ReasonBody } from "@/lib/admin-api/schemas";
import { pauseEngineer } from "@/lib/admin/engineers";

// Pause an engineer: no new offers or texts until resumed. Existing customers
// and their plans carry on.
export const POST = adminRoute<{ engineerId: string }>("engineers:status", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, ReasonBody);
  return pauseEngineer(admin, params.engineerId, reason);
});
