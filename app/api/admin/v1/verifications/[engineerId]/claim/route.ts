import { adminRoute } from "@/lib/admin-api/route";
import { claimVerification } from "@/lib/admin/verifications";

// Claim a waiting application while checking it (15 minutes, refreshed while
// it's open). If another admin holds it, the answer says who and until when.
export const POST = adminRoute<{ engineerId: string }>("verification:decide", async ({ admin, params }) =>
  claimVerification(admin, params.engineerId),
);
