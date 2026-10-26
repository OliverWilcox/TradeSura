import { adminRoute, notFound } from "@/lib/admin-api/route";
import { getVerification } from "@/lib/admin/verifications";

// One application: what the checker needs to decide it, and where it sits in the queue.
export const GET = adminRoute<{ engineerId: string }>("verification:read", async ({ params }) => {
  const detail = await getVerification(params.engineerId);
  if (!detail) throw notFound("There's no engineer with that ID.");
  return detail;
});
