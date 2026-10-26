import { adminRoute } from "@/lib/admin-api/route";
import { engineerFilterOptions } from "@/lib/admin/engineers";

// What the engineer list can be filtered by: towns and sign-up channels in use.
export const GET = adminRoute("engineers:read", async () => engineerFilterOptions());
