import { AdminApiError, adminRoute } from "@/lib/admin-api/route";
import { isMonth } from "@/lib/fee-statement";
import { engineerStatement } from "@/lib/admin/statements";

export const GET = adminRoute<{ engineerId: string; month: string }>("engineers:read", async ({ params }) => {
  if (!isMonth(params.month)) throw new AdminApiError(400, "VALIDATION", "Months are written YYYY-MM.");
  return engineerStatement(params.engineerId, params.month);
});
