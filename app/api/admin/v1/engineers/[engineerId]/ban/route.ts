import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { ReasonBody } from "@/lib/admin-api/schemas";
import { banEngineer } from "@/lib/admin/engineers";

// Ban an engineer: off town pages and enquiries, and no new offers or texts.
export const POST = adminRoute<{ engineerId: string }>("engineers:ban", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, ReasonBody);
  return banEngineer(admin, params.engineerId, reason);
});
