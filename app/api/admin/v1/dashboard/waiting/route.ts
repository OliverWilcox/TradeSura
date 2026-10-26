import { adminRoute } from "@/lib/admin-api/route";
import { waiting } from "@/lib/admin/dashboard";

// What's waiting on the team right now: the verification queue, member packs
// to post and cancel requests still open.
export const GET = adminRoute("dashboard:read", async () => waiting());
