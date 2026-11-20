import { adminRoute, parseBody } from "@/lib/admin-api/route";
import { ReasonBody } from "@/lib/admin-api/schemas";
import { reportReview } from "@/lib/admin/reviews";

export const POST = adminRoute<{ engineerId: string; ratingId: string }>("reviews:report", async ({ req, admin, params }) => {
  const { reason } = await parseBody(req, ReasonBody);
  return reportReview(admin, params.engineerId, params.ratingId, reason);
});
