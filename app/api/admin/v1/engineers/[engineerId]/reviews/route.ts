import { adminRoute } from "@/lib/admin-api/route";
import { engineerReviews } from "@/lib/admin/reviews";

export const GET = adminRoute<{ engineerId: string }>("engineers:read", async ({ params }) => engineerReviews(params.engineerId));
