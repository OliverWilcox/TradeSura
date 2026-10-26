import { adminRoute, notFound } from "@/lib/admin-api/route";
import { getEngineer } from "@/lib/admin/engineers";

// One engineer in full. Contact details come masked; POST …/contact reveals them.
export const GET = adminRoute<{ engineerId: string }>("engineers:read", async ({ params }) => {
  const engineer = await getEngineer(params.engineerId);
  if (!engineer) throw notFound("There's no engineer with that ID.");
  return engineer;
});
