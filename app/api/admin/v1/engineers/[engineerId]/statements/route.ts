import { adminRoute } from "@/lib/admin-api/route";
import { engineerStatementMonths } from "@/lib/admin/statements";

export const GET = adminRoute<{ engineerId: string }>("engineers:read", async ({ params }) => engineerStatementMonths(params.engineerId));
