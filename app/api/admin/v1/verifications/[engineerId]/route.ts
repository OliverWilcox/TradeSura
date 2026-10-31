import { adminRoute, notFound } from "@/lib/admin-api/route";
import { getVerification } from "@/lib/admin/verifications";

// One application: what the checker needs to decide it, and where it sits in
// the queue. Contact details (masked) only for admins who may see them.
export const GET = adminRoute<{ engineerId: string }>("verification:read", async ({ admin, params }) => {
  const detail = await getVerification(params.engineerId, { withContact: admin.permissions.includes("pii:reveal") });
  if (!detail) throw notFound("There's no engineer with that ID.");
  return detail;
});
