import { adminRoute } from "@/lib/admin-api/route";
import { markPackPosted } from "@/lib/admin/member-packs";

// Mark an engineer's member pack as posted. Only once, and only once their
// badge is live and they aren't paused or banned (409 otherwise).
export const POST = adminRoute<{ engineerId: string }>("member_packs:mark_posted", async ({ admin, params }) =>
  markPackPosted(admin, params.engineerId),
);
